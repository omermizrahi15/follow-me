// Transport plumbing for Twilio's inbound webhooks. Server-only, so it lives
// here rather than in src/ — what a request *means* (parseInboundCommand) and
// whether it is genuine (verifyTwilioSignature) are domain/infrastructure code
// the app shares, and are imported from there.

/** Flattens a Twilio webhook's form-encoded POST into a string map (drops File entries). */
export function formToParams(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params[key] = value;
  }
  return params;
}
