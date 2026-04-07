import React from 'react';
import { render, Text } from 'ink';
import { Command } from 'commander';
import { setEmail, addProxy, loadAuthConfig } from '../../auth/config';

export function registerAuthCommand(program: Command): void {
  const auth = program.command('auth').description('Configure authentication');

  auth
    .command('set-email <email>')
    .description('Set email for Unpaywall API')
    .action((email: string) => {
      setEmail(email);
      render(<Text color="green">Email set: {email}</Text>);
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
        render(<Text color="green">Proxy '{name}' added.</Text>);
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
      render(<Text>{JSON.stringify(sanitized, null, 2)}</Text>);
    });
}
