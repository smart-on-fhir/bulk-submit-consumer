import createApp from './app';
import { PORT }  from './config';


const app = createApp();

const server = app.listen(Number(PORT), '0.0.0.0', (error) => {
  if (error) {
    throw error; // e.g. EADDRINUSE
  }
  console.log(`Listening on ${JSON.stringify(server.address())}`)
});