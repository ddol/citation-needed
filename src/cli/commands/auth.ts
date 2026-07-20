import { Command } from 'commander';
import { setEmail, addProxy, loadAuthConfig } from '../../auth/config';
import { green, print, printError, red } from '../output';

export function registerAuthCommand(program: Command): void {
  const auth = program.command('auth').description('Configure authentication');

  auth
    .command('set-email <email>')
    .description('Set email for Unpaywall API')
    .action((email: string) => {
      try {
        setEmail(email);
        print(green(`Email set: ${email}`));
      } catch (err) {
        printError(red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
      }
    });

  auth
    .command('add-proxy <name> <proxyUrl>')
    .description('Add institutional proxy')
    .option('--login-url <url>', 'Proxy login URL')
    .option('--username <username>', 'Proxy username')
    .option('--password-env <envVar>', 'Env variable name holding the password')
    .action(
      (
        name: string,
        proxyUrl: string,
        options: { loginUrl?: string; username?: string; passwordEnv?: string }
      ) => {
        addProxy({
          name,
          proxyUrl,
          loginUrl: options.loginUrl,
          username: options.username,
          passwordEnvVar: options.passwordEnv,
        });
        print(green(`Proxy '${name}' added.`));
      }
    );

  auth
    .command('show')
    .description('Show current auth configuration')
    .action(() => {
      const config = loadAuthConfig();
      const sanitized = {
        ...config,
        proxies: config.proxies?.map((p) => ({
          ...p,
          passwordEnvVar: p.passwordEnvVar ? '***' : undefined,
        })),
      };
      print(JSON.stringify(sanitized, null, 2));
    });
}
