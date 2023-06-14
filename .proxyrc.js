module.exports = function (app) {
    app.use((req, res, next) => {
        // res.removeHeader('Cross-Origin-Resource-Policy');
        // res.removeHeader('Cross-Origin-Embedder-Policy');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        next();
    });
};