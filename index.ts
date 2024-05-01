import { z } from "zod";
import { callWithRetries, ClaudeModel, GPTModel, GroqModel } from "190proof";

const fnDefinitions = new Map();

export function define(
  fnName: string,
  inputSchema: z.ZodType<any, any>,
  outputSchema: z.ZodType<any, any>
) {
  console.log("Defining function:", fnName);
  fnDefinitions.set(fnName, { fnName, inputSchema, outputSchema });
}

export async function invoke(
  fnName: string,
  args: Record<string, any>
): Promise<any> {
  console.log("Invoking function:", fnName, args);
  const { inputSchema, outputSchema } = fnDefinitions.get(fnName);

  // validate the input schema
  const parsedArgs = inputSchema.parse(args);

  const returnFnDefinition = {
    name: "return",
    parameters: {
      type: "object",
      properties: outputSchema.shape,
      required: Object.keys(outputSchema.shape),
    },
  };

  // Here you should call the actual function with the name `fnName` and pass `parsedArgs` to it
  const llmAnswer = await callWithRetries(fnName, {
    model: ClaudeModel.HAIKU,
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
  const rawResult = llmAnswer.function_call?.arguments;

  // validate the output schema
  const result = outputSchema.parse(rawResult);

  // TODO: have retries and fallbacks here in case we fail schema validation

  return result;
}

export async function expand(xType: string): Promise<readonly string[]> {
  console.log("Expanding array of type:", xType);
  const llmAnswer = await callWithRetries("expand", {
    model: GroqModel.LLAMA_3_70B_8192,
    messages: [
      {
        role: "user",
        content: `List every reasonable possible value for this type using the "return" function: ${xType}`,
      },
    ],
    functions: [
      {
        name: "return",
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
  });

  // console.log("llmAnswer", JSON.stringify(llmAnswer, null, 2));

  const rawResult = llmAnswer.function_call?.arguments;
  return rawResult?.list ?? ["Indeterminate"];
}
