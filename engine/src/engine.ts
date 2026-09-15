import { startEngine } from "./bootstrap";
import { registerTools, type ToolRegistry } from "./tools/registry";

function main() {
  const send = (msg: unknown) => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };

  const tools: ToolRegistry = new Map();
  registerTools(tools);

  startEngine({ send, tools });
}

main();
