/** B-94 (S-BTN-41): fail instead of asking the terminal or opening an askpass program. */
export const GIT_NONINTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  SSH_ASKPASS: '',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=20',
};
