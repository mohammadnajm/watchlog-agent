require('app-module-path').addPath(__dirname);
require('dotenv').config()
const App = require('./app');
new App();