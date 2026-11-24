'use strict';
const server = require('./app');

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`PixSabi is live at http://localhost:${PORT}`);
});
