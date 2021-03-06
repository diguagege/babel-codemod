import { writeFileSync } from 'fs';
import { basename } from 'path';
import iterateSources from './iterateSources';
import Options, { DEFAULT_EXTENSIONS } from './Options';
import TransformRunner, { Source, SourceTransformResult } from './TransformRunner';

function printHelp(out: NodeJS.WritableStream) {
  let $0 = basename(process.argv[1]);

  out.write(`
${$0} [OPTIONS] [PATH … | --stdio]

OPTIONS
  -p, --plugin PLUGIN               Transform sources with PLUGIN (allows multiple).
  -o, --plugin-options PLUGIN=OPTS  JSON-encoded OPTS for PLUGIN (allows multiple).
  -r, --require PATH                Require PATH before transform (allows multiple).
      --extensions EXTS             Comma-separated extensions to process (default: "${Array.from(DEFAULT_EXTENSIONS).join(',')}").
  -s, --stdio                       Read source from stdin and print to stdout.
  -h, --help                        Show this help message.

EXAMPLES
  # Run with a relative plugin on all files in \`src/\`.
  $ ${$0} -p ./typecheck.js src/

  # Run with multiple plugins.
  $ ${$0} -p ./a.js -p ./b.js some-file.js

  # Run with a plugin in \`node_modules\` on stdin.
  $ ${$0} -s -p babel-plugin-typecheck <<EOS
  function add(a: number, b: number): number {
    return a + b;
  }
  EOS

  # Pass options to a plugin.
  $ ${$0} -p ./a.js -o a='{"foo":true}' src/

  # Pass options from a config file to a plugin.
  $ ${$0} -p ./a.js -o a=@opts.json src/

  # Run with a plugin which itself is transpiled using babel.
  $ ${$0} -r babel-register -p ./some-plugin.js src/

  # Run with a plugin written in TypeScript.
  $ ${$0} -r ts-node/register -p ./some-plugin.ts src/
  `.trim());
  out.write('\n');
}

export default async function run(args: Array<string>) {
  let options = Options.parse(args);

  if (options instanceof Error) {
    process.stderr.write(`ERROR: ${options.message}\n`);
    printHelp(process.stderr);
    process.exit(1);
    return;
  }

  if (options.help) {
    printHelp(process.stdout);
    process.exit(0);
    return;
  }

  options.loadRequires();

  let plugins = options.getPlugins();
  let runner: TransformRunner;

  if (options.stdio) {
    runner = new TransformRunner([new Source('<stdin>', await readStdin())][Symbol.iterator](), plugins, {
      transformSourceEnd(runner: TransformRunner, transformed: SourceTransformResult) {
        if (transformed.output) {
          process.stdout.write(transformed.output);
        } else if (transformed.error) {
          console.error(transformed.error.stack);
        }
      }
    });
  } else {
    runner = new TransformRunner(iterateSources(options.sourcePaths, options.extensions, options.ignore), plugins, {
      transformSourceEnd(runner: TransformRunner, transformed: SourceTransformResult) {
        if (transformed.output) {
          if (transformed.output !== transformed.source.content) {
            console.log(transformed.source.path);
            writeFileSync(transformed.source.path, transformed.output);
          }
        } else if (transformed.error) {
          console.error(`Encountered an error while processing ${transformed.source.path}:`);
          console.error(transformed.error.stack);
        }
      }
    });
  }

  let hasErrors = false;

  for (let result of runner.run()) {
    if (result.error !== null) {
      hasErrors = true;
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

/**
 * Reads stdin and resolves to the read string.
 */
async function readStdin(): Promise<string> {
  return new Promise<string>(resolve => {
    let code = '';

    process.stdin.on('data', data => {
      code += data;
    });

    process.stdin.on('end', () => {
      resolve(code);
    });
  });
}
