import chalk from 'chalk';

export const logger = {
  step: (text: string) => {
    console.log(chalk.white(`\n● ${chalk.bold(text)}`));
  },

  action: (verb: string, detail: string) => {
    // Style: "  └ [Verb] detail"
    // Verb in Cyan, detail in White/Gray
    console.log(chalk.gray(`  └ `) + chalk.cyan(verb.padEnd(6)) + chalk.white(detail));
  },

  subAction: (text: string) => {
    console.log(chalk.gray(`    ${text}`));
  },

  success: (text: string) => {
    console.log(chalk.green(`\n✓ ${chalk.bold(text)}`));
  },

  error: (text: string) => {
    console.log(chalk.red(`\n✗ ${chalk.bold(text)}`));
  },

  info: (text: string) => {
    console.log(chalk.gray(`  ${text}`));
  },
  
  agent: (name: string, model: string) => {
      console.log(chalk.gray(`\n  ┌── [${name}] (${model})`));
  },
  
  agentLine: (line: string) => {
      console.log(chalk.gray(`  │ ${line}`));
  },
  
  agentEnd: () => {
      console.log(chalk.gray(`  └──────────────────────────────────────────`));
  }
};
