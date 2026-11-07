// Public: the Google client ID is not a secret; the login page needs it to render the button.
export const onRequestGet = ({ env }) => Response.json({ clientId: env.GOOGLE_CLIENT_ID || null });
