// `npm start` is unambiguously production. Direct server entry points still
// require NODE_ENV explicitly so an omitted variable can never select a weaker
// authority or authentication policy.
process.env.NODE_ENV = 'production'
await import('../server/index.ts')
