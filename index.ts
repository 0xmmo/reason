import { z } from "zod";
import { callWithRetries, ClaudeModel, GPTModel, GroqModel } from "190proof";

const fnDefinitions = new Map();

export async function define(
  fnKind: "gen" | "reason",
  fnName: string,
  inputSchema: z.ZodType<any, any>,
  outputSchema: z.ZodType<any, any>
) {
  console.log("Defining function:", fnName);

  let fnBody: string | null = null;
  if (fnKind === "gen") {
    const llmAnswer = await callWithRetries("gen", {
      model: GroqModel.LLAMA_3_70B_8192,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `Write the best possible definition for the provided Javascript method. Only respond with the method definition and nothing else.

# Example:
Method Name: add(arg)
Input 'arg' Schema: { a: number, b: number }
Return object Schema: { result: number }
# Response:
async function add(arg) {
  return { result: args.a + args.b };
}

# Your Turn:
Method Name: ${fnName}(arg)
Input 'arg' Schema: ${inputSchema.toString()}
Return object Schema: ${outputSchema.toString()}
# Response:`,
        },
      ],
      // functions: [
      //   {
      //     name: "writeJavascriptMethod",
      //     description:
      //       "Used to return the full definition of the Javascript method.",
      //     parameters: {
      //       type: "object",
      //       properties: {
      //         definition: {
      //           type: "string",
      //         },
      //       },
      //       required: ["definition"],
      //     },
      //   },
      // ],
      // function_call: {
      //   name: "writeJavascriptMethod",
      // },
    });
    // console.log("llmAnswer", JSON.stringify(llmAnswer, null, 2));

    fnBody = llmAnswer.content;
    // fnBody = llmAnswer.function_call?.arguments.definition;

    // if (!fnBody) {
    //   throw new Error("Failed to get function definition from LLM " + fnName);
    // }
  }

  fnDefinitions.set(fnName, {
    fnKind,
    fnName,
    inputSchema,
    outputSchema,
    fnBody,
  });
}

export async function invoke(
  fnName: string,
  args: Record<string, any>
): Promise<any> {
  console.log("Invoking function:", fnName, args);
  const { inputSchema, outputSchema, fnKind, fnBody } =
    fnDefinitions.get(fnName);

  // validate the input schema
  const parsedArgs = inputSchema.parse(args);

  let rawResult;
  if (fnKind === "gen") {
    const jsCode = `${fnBody}\n${fnName}(${JSON.stringify(parsedArgs)})`;

    rawResult = await eval(jsCode);
  } else {
    const returnFnDefinition = {
      name: "return",
      description: "Returns the guessed/calculated result of the evaluation.",
      parameters: {
        type: "object",
        properties: outputSchema.shape,
        required: Object.keys(outputSchema.shape),
      },
    };

    // Here you should call the actual function with the name `fnName` and pass `parsedArgs` to it
    const llmAnswer = await callWithRetries(fnName, {
      model: GroqModel.LLAMA_3_70B_8192,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are a Javascript virtual machine that executes hypothetical functions by assuming their implementation details and return the most likely answer. Evaluate the following code and use the return tool to provide the result.`,
        },
        {
          role: "user",
          content: `${fnName}(${JSON.stringify(parsedArgs)})`,
        },
      ],
      functions: [returnFnDefinition],
      function_call: {
        name: returnFnDefinition.name,
      },
    });

    // console.log("llmAnswer", JSON.stringify(llmAnswer, null, 2));
    rawResult = llmAnswer.function_call?.arguments;
  }

  // validate the output schema
  const result = outputSchema.parse(rawResult);

  // TODO: have retries and fallbacks here in case we fail schema validation

  return result;
}

export async function expand(xType: string): Promise<readonly string[]> {
  console.log("Expanding array of type:", xType);
  const llmAnswer = await callWithRetries("expand", {
    model: GroqModel.LLAMA_3_70B_8192,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: `List every reasonable possible value for this type using the "return" function: ${xType}`,
      },
    ],
    functions: [
      {
        name: "return",
        description: "Used to return the list of possible values.",
        parameters: {
          type: "object",
          properties: {
            list: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
          required: ["list"],
        },
      },
    ],
    function_call: {
      name: "return",
    },
  });

  // console.log("llmAnswer", JSON.stringify(llmAnswer, null, 2));

  const rawResult = llmAnswer.function_call?.arguments;
  return rawResult?.list ?? ["Indeterminate"];
}
