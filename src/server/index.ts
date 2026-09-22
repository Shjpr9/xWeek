import { app } from './app.js';
import { config } from './config.js';

app.listen(config.PORT, config.HOST, () => {
  console.log(`xWeek listening on http://${config.HOST}:${config.PORT}`);
});
