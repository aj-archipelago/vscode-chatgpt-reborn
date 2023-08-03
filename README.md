# Knuth VSC

Knuth VSC is a Visual Studio Code extension that allows you to use LLMs like OpenAI's GPT\* models to write, refactor, and improve your code. While it is an Al Jazeera internal tool from the Archipelago team, and is customized for our work environment at AJ, it is entirely based on a fork of the excellent open source work of Chris Hayes' [ChatGPT-Reborn project] (https://github.com/Christopher-Hayes/vscode-chatgpt-reborn) which is in itself based on a fork of the now discontinued [vscode-chatgpt](https://github.com/gencay/vscode-chatgpt). Full credit should go to @chris-hayes and @gencay for providing such a strong base product and open-sourcing it.

## Get for VSCode

At this point, you can get the VSIX file from internal distribution or build the extension yourself. We have not published to the Visual Studio Code Marketplace.

## Installation

To set up the project, first clone the repository:

```bash
git clone https://github.com/christopher-hayes/vscode-chatgpt-reborn.git
```

Next, change into the project directory and install the dependencies using Yarn:

```bash
cd vscode-chatgpt-reborn
yarn install
```

## Running Scripts

You can run the following scripts using Yarn:

### Build the extension

```bash
yarn run build
```

### Watch for changes and rebuild automatically

```bash
yarn run watch
```

### Format the code using Prettier and run tests with fixes

```bash
yarn run fmt
```

### Run tests using ESLint and TypeScript

```bash
yarn run test
```

## Testing the Extension in Visual Studio Code

To test the extension in Visual Studio Code, follow these steps:

1. Open the project directory in Visual Studio Code.

2. Press `F5` or click `Run > Start Debugging` in the menu to start a new Extension Development Host instance with the extension loaded.

3. In the Extension Development Host instance, test the extension's functionality.

4. Use the Debug Console in the main Visual Studio Code window to view any output or errors.

5. If you need to make changes to the extension, stop the Extension Development Host, make the changes, and then start the Extension Development Host again.

6. Once you are satisfied with your changes, submit a pull request to the original repository.

## Tech

[Yarn](https://yarnpkg.com/) - [TypeScript](https://www.typescriptlang.org/) - [VSCode Extension API](https://code.visualstudio.com/api) - [React](https://reactjs.org/) - [Redux](https://redux.js.org/) - [React Router](https://reactrouter.com/) - [Tailwind CSS](https://tailwindcss.com/)

- The UI is built with TailwindCSS. But, respecting VSCode's UI consistency and theme support is still a priority.
- This does not use VSCode's [WebView UI Toolkit](https://github.com/microsoft/vscode-webview-ui-toolkit/tree/main/src). But, I'm open to switching to the WebView UI toolkit since it better aligns with VSCode's UI.

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## Changelog

### August 2nd, 2023

Renamed to Knuth VSC and initial commit
