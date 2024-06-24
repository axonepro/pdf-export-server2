const express = require('express');
const addRequestId = require('express-request-id')();
const bodyParser = require('body-parser');
const nanoid = require('nanoid');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const serveStatic = require('serve-static');
const ExportServer = require('./ExportServer.js');
const { RequestCancelError } = require('../exception.js');
require("dotenv").config();

module.exports = class WebServer extends ExportServer {
    constructor(config) {
        super(config);

        this.files = {};

        this.createServer(config);
    }

    createServer(options) {
        const me = this,
              app = me.app = express();

        options = Object.assign({
            timeout: 5 * 60 * 1000 // 5 minutes
        }, options);

        const PORT = process.env.PORT || options.http || 8080;

        app.get("/", (req, res) => {
            res.send("OOTI PDF export");
        });

        app.use(addRequestId);
        app.use(bodyParser.json({ limit: options.maximum || '50mb' }));
        app.use(bodyParser.urlencoded({ extended: false, limit: options.maximum || '50mb' }));

        if (options.cors !== 'false') {
            options.cors = options.cors || '*';
            console.log(`Access-Control-Allow-Origin: ${options.cors}`);

            app.use((req, res, next) => {
                res.header('Access-Control-Allow-Origin', options.cors);
                res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
                next();
            });
        }

        if (options.resources) {
            app.use('/resources', serveStatic(options.resources));
        }

        app.get('/:fileKey/', (req, res) => {
            const fileKey = req.params.fileKey,
                  file = me.files[fileKey];

            if (file) {
                res.set('Content-Type', 'application/' + file.fileFormat);
                res.set('Content-Disposition', 'form-data; filename="' + file.fileName + '"');
                res.set('Access-Control-Expose-Headers', 'Content-Length');
                res.set('Content-Length', file.buffer.length);
                res.status(200).send(file.buffer);

                delete me.files[fileKey];
            } else {
                res.send('File not found');
            }
        });

        if (!options.dedicated) {
            app.post('/', (req, res) => {
                const request = req.body;

                if (typeof request.html === 'string') {
                    request.html = JSON.parse(request.html);
                }

                me.logger.log('info', `POST request ${req.id}`);
                me.logger.log('verbose', `POST request ${req.id} headers: ${JSON.stringify(req.headers)}`);

                me.exportRequestHandler(request, req.id, req).then(file => {
                    me.logger.log('info', `POST request ${req.id} succeeded`);

                    if (request.sendAsBinary) {
                        res.set('Content-Type', 'application/octet-stream');
                        res.status(200).send(file);
                    } else {
                        res.status(200).jsonp({
                            success: true,
                            url: me.setFile(req.protocol + '://' + req.get('host') + req.originalUrl, request, file)
                        });
                    }
                }).catch(e => {
                    if (e instanceof RequestCancelError) {
                        me.logger.log('verbose', `POST request ${req.id} cancelled`);
                    } else {
                        me.logger.log('warn', `POST request ${req.id} failed`);
                        me.logger.log('warn', e.stack);
                        res.status(request.sendAsBinary ? 500 : 200).jsonp({
                            success: false,
                            msg: e.message,
                            stack: e.stack
                        });
                    }
                });
            });
        }

        app.use((err, req, res, next) => {
            me.logger.error(err.stack);
            next(err);
        });

        me.httpPort = PORT;
        me.httpsPort = PORT;

        me.httpServer = me.createHttpServer();
        me.httpServer.timeout = options.timeout;

        me.httpsServer = me.createHttpsServer(path.join(process.cwd(), 'cert'));
        me.httpsServer.timeout = options.timeout;
    }

    setFile(host, request, file) {
        const me = this,
              fileKey = nanoid(),
              url = host + fileKey;

        me.files[fileKey] = {
            date: new Date(),
            fileFormat: request.fileFormat,
            fileName: `${request.fileName || `export-${request.range}`}.${request.fileFormat}`,
            buffer: file
        };

        setTimeout(() => {
            delete me.files[fileKey];
        }, 10000);

        return url;
    }

    createHttpServer() {
        return http.createServer(this.app);
    }

    startHttpServer() {
        if (this.httpServer) {
            return new Promise((resolve, reject) => {
                this.httpServer.on('error', e => {
                    if (e.code === 'EADDRINUSE' && this.findNextHttpPort) {
                        this.httpServer.listen(++this.httpPort);
                    } else {
                        reject(e);
                    }
                });

                this.httpServer.on('listening', () => {
                    console.log('Http server started on port ' + this.httpPort);
                    resolve();
                });

                this.httpServer.listen(this.httpPort);
            });
        }
    }

    createHttpsServer(certPath) {
        const privateKey = fs.readFileSync(path.join(certPath, 'server.key'), 'utf8'),
              certificate = fs.readFileSync(path.join(certPath, 'server.crt'), 'utf8'),
              credentials = { key: privateKey, cert: certificate };

        return https.createServer(credentials, this.app);
    }

    startHttpsServer() {
        if (this.httpsServer) {
            return new Promise(resolve => {
                this.httpsServer.listen(this.httpsPort, () => {
                    console.log('Https server started on port ' + this.httpsPort);
                    resolve();
                });
            });
        }
    }

    getHttpServer() {
        return this.httpServer;
    }

    getHttpsServer() {
        return this.httpsServer;
    }

    start() {
        return Promise.all([
            this.startHttpServer(),
            this.startHttpsServer()
        ]);
    }
};
