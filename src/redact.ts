const DIRECT_SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\blin_api_[A-Za-z0-9]+\b/g,
  /\blin_wh_[A-Za-z0-9]+\b/g,
  /\bsk-ant-[A-Za-z0-9_-]+\b/g,
  /\bsk-proj-[A-Za-z0-9_-]+\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~-]{16,}\b/gi,
  /\bAuthorization:\s*[^\s]+\b/gi,
  /\bLINEAR_WEBHOOK_SECRET=[^\s]+\b/g,
  /\b(?:LINEAR_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|STATUS_TOKEN)=[^\s]+\b/g,
];

function redactKnownEnvValues(input: string): string {
  const secrets = [
    process.env.LINEAR_API_KEY,
    process.env.LINEAR_WEBHOOK_SECRET,
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.STATUS_TOKEN,
  ].filter((value): value is string => Boolean(value));

  let output = input;
  for (const secret of secrets) {
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

export function redactSecrets(input: string): string {
  let output = redactKnownEnvValues(input);
  for (const pattern of DIRECT_SECRET_PATTERNS) {
    output = output.replace(pattern, "[redacted]");
  }
  return output;
}
