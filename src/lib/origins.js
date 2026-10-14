'use strict';
// Slides serves its studio over plain HTTP on a loopback address (src/server.js refuses any other Host). This one
// helper builds that http:// origin for the server, the dashboard session and the ppt CLI; src/server.js also lists
// the fixed loopback origins http://127.0.0.1:<port> and http://localhost:<port> that it accepts.
// hostAndPort is a Host header value or "<host>:<port>".
function httpOrigin(hostAndPort) {
  return `http://${hostAndPort}`;
}
module.exports = { httpOrigin };
