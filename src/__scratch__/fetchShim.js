const f = require("node-fetch");
global.fetch = f.default || f;
global.Headers = f.Headers;
global.Request = f.Request;
global.Response = f.Response;
