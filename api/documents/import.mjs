// Give Vercel an explicit function route for the nested public import endpoint.
// The shared Express app still owns request parsing, security, and the route itself.
export { default } from '../../server/index.mjs';
