/**
 * Turn an error into a short, friendly message for the user.
 * No error codes, no JSON, no technical jargon.
 */

/**
 * @param {Error|string|unknown} err
 * @returns {string}
 */
export function toUserMessage(err) {
  const msg = (err && (err.message || err)) && String(err.message || err).trim();
  if (!msg) return "Something went wrong. Please try again.";
  if (/401|409|authentication|api key|unauthorized|x-api-key|required/i.test(msg)) return "I couldn't sign in. Check your API key in setup.";
  if (/timeout/i.test(msg)) return "That took too long. Please try again.";
  if (/No LLM configured|No vision-capable/i.test(msg)) return "AI isn't set up. Run setup to add a model and key.";
  return "Something went wrong. Please try again.";
}
