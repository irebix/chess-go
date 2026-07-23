const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (_env, argv) => ({
  mode: argv.mode || "development",
  entry: path.resolve(__dirname, "src/main.tsx"),
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "main.js",
    clean: true,
    globalObject: "globalThis"
  },
  devtool: argv.mode === "production" ? false : "inline-source-map",
  target: ["web", "es2019"],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: { transpileOnly: false }
        }
      }
    ]
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    fallback: {
      fs: false,
      path: false,
      stream: false,
      util: false
    }
  },
  externals: {
    photoshop: "commonjs2 photoshop",
    uxp: "commonjs2 uxp"
  },
  optimization: {
    splitChunks: false,
    runtimeChunk: false
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: "manifest.json", to: "manifest.json" },
        { from: "Holopix.json", to: "Holopix.json" },
        { from: "GptImage2.json", to: "GptImage2.json" },
        { from: "GPlusF.json", to: "GPlusF.json" },
        { from: "ImageEditor.json", to: "ImageEditor.json" },
        { from: "ImageRefiner.json", to: "ImageRefiner.json" },
        { from: "ImageRefinerStyle.png", to: "ImageRefinerStyle.png" },
        { from: "src/index.html", to: "index.html" },
        { from: "src/styles.css", to: "styles.css" }
      ]
    })
  ]
});
