import hljs from 'highlight.js';
import { marked } from "marked";
import { Configuration, OpenAIApi } from "openai";
import { v4 as uuidv4 } from "uuid";
import * as vscode from 'vscode';
import { ActionRunner } from "./actionRunner";
import { ApiProvider, MODEL_TOKEN_LIMITS } from "./api-provider";
import Auth from "./auth";
import { loadTranslations } from './localization';
import { ActionNames, Conversation, Message, Model, Role, Verbosity } from "./renderer/types";
import { unEscapeHTML } from "./renderer/utils";

export interface ApiRequestOptions {
	command: string,
	conversation: Conversation,
	questionId?: string,
	messageId?: string,
	code?: string,
	language?: string;
	topP?: number;
	temperature?: number;
	maxTokens?: number;
}

export default class ChatGptViewProvider implements vscode.WebviewViewProvider {
	private webView?: vscode.WebviewView;

	public subscribeToResponse: boolean;
	public model?: string;

	private api: ApiProvider = new ApiProvider('');
	private _maxTokens: number = 2048;
	private _temperature: number = 0.9;
	private _topP: number = 1;
	private chatMode?: boolean = true;
	private systemContext: string;

	private throttling: number = 100;
	private abortControllers: {
		conversationId?: string,
		actionName?: string,
		controller: AbortController;
	}[] = [];
	private chatGPTModels: Model[] = [];
	private authStore?: Auth;

	public currentConversation?: Conversation;

	/**
	 * Message to be rendered lazily if they haven't been rendered
	 * in time before resolveWebviewView is called.
	 */
	private leftOverMessage?: any;
	constructor(private context: vscode.ExtensionContext) {
		this.subscribeToResponse = vscode.workspace.getConfiguration("knuth-vsc").get("response.showNotification") || false;
		this.model = vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.model") as string;
		this.systemContext = vscode.workspace.getConfiguration('knuth-vsc').get('systemContext') ?? vscode.workspace.getConfiguration('knuth-vsc').get('systemContext.default') ?? '';
		this.throttling = vscode.workspace.getConfiguration("knuth-vsc").get("throttling") || 100;

		// Secret storage
		Auth.init(context);
		this.authStore = Auth.instance;
		vscode.commands.registerCommand("knuth_vsc.setOpenAIApiKey", async (apiKey: string) => {
			if (this.authStore) {
				await this.authStore.storeAuthData(apiKey);
			} else {
				console.error("Auth store not initialized");
			}
		});
		vscode.commands.registerCommand("knuth_vsc.getOpenAIApiKey", async () => {
			if (this.authStore) {
				const tokenOutput = await this.authStore.getAuthData();
				return tokenOutput;
			} else {
				console.error("Auth store not initialized");
				return undefined;
			}
		});

		// Check config settings for "knuth-vsc.gpt3.apiKey", if it exists, move it to the secret storage and remove it from the config
		const apiKey = vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.apiKey") as string;
		if (apiKey) {
			this.authStore.storeAuthData(apiKey);
			vscode.workspace.getConfiguration("knuth-vsc").update("gpt3.apiKey", undefined, true);
		}

		// Check config settings for "knuth-vsc.gpt3.apiBaseUrl", if it is set to "https://api.openai.com", change it to "https://api.openai.com/v1"
		const baseUrl = vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.apiBaseUrl") as string;
		if (baseUrl === "https://api.openai.com") {
			vscode.workspace.getConfiguration("knuth-vsc").update("gpt3.apiBaseUrl", "https://api.openai.com/v1", true);
		}

		// If apiBaseUrl is in old "https://api.openai.com" format, update to format "https://api.openai.com/v1"
		// This update puts "apiBaseUrl" in line with the "basePath" format used by the OpenAI's official SDK
		if (vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.apiBaseUrl") === "https://api.openai.com") {
			vscode.workspace.getConfiguration("knuth-vsc").update("gpt3.apiBaseUrl", "https://api.openai.com/v1", true);
		}

		this._maxTokens = vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.maxTokens") as number;
		this._temperature = vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.temperature") as number;
		this._topP = vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.top_p") as number;

		// Initialize the API
		this.authStore.getAuthData().then((apiKey) => {
			this.api = new ApiProvider(
				apiKey ?? "",
				{
					organizationId: vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.organization") as string,
					apiBaseUrl: vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.apiBaseUrl") as string,
					maxTokens: vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.maxTokens") as number,
					temperature: vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.temperature") as number,
					topP: vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.top_p") as number,
				});
		});

		// Update data members when the config settings change
		vscode.workspace.onDidChangeConfiguration((e) => {
			// Model
			if (e.affectsConfiguration("knuth-vsc.gpt3.model")) {
				this.model = vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.model") as string;
			}
			// System Context
			if (e.affectsConfiguration("knuth-vsc.systemContext")) {
				this.systemContext = vscode.workspace.getConfiguration('knuth-vsc').get('systemContext') ?? vscode.workspace.getConfiguration('knuth-vsc').get('systemContext.default') ?? '';
			}
			// Throttling
			if (e.affectsConfiguration("knuth-vsc.throttling")) {
				this.throttling = vscode.workspace.getConfiguration("knuth-vsc").get("throttling") ?? 100;
			}
			// organization
			if (e.affectsConfiguration("knuth-vsc.gpt3.organization")) {
				this.api.updateOrganizationId(vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.organization") ?? "");
			}
			// Api Base Url
			if (e.affectsConfiguration("knuth-vsc.gpt3.apiBaseUrl")) {
				this.api.updateApiBaseUrl(vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.apiBaseUrl") ?? "");
			}
			// maxTokens
			if (e.affectsConfiguration("knuth-vsc.gpt3.maxTokens")) {
				this.api.maxTokens = this._maxTokens = vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.maxTokens") as number ?? 2048;
			}
			// temperature
			if (e.affectsConfiguration("knuth-vsc.gpt3.temperature")) {
				this.api.temperature = this._temperature = vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.temperature") as number ?? 0.9;
			}
			// topP
			if (e.affectsConfiguration("knuth-vsc.gpt3.top_p")) {
				this.api.topP = this._topP = vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.top_p") as number ?? 1;
			}
		});

		// if any of the extension settings change, send a message to the webview for the "settingsUpdate" event
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("knuth-vsc")) {
				this.sendMessage({
					type: "settingsUpdate",
					value: vscode.workspace.getConfiguration("knuth-vsc")
				});
			}
		});

		// Load translations
		loadTranslations(context.extensionPath).then((translations) => {
			// Serialize and send translations to the webview
			const serializedTranslations = JSON.stringify(translations);

			this.sendMessage({ type: 'setTranslations', value: serializedTranslations });
		}).catch((err) => {
			console.error("Failed to load translations", err);
		});
	}

	// Param is optional - if provided, it will change the API key to the provided value
	// This func validates the API key against the OpenAI API (and notifies the webview of the result)
	// If valid it updates the chatGPTModels array (and notifies the webview of the available models)
	public async updateApiKeyState(apiKey: string = '') {
		if (apiKey) {
			// Run the setOpenAIApiKey command
			await vscode.commands.executeCommand("knuth_vsc.setOpenAIApiKey", apiKey);
		}

		let { valid, models } = await this.isGoodApiKey(apiKey);

		this.sendMessage({
			type: "updateApiKeyStatus",
			value: valid,
		});

		if (valid) {
			// Get an updated list of models
			this.getChatGPTModels(models).then(async (models) => {
				this.chatGPTModels = models;

				this.sendMessage({
					type: "chatGPTModels",
					value: this.chatGPTModels
				});
			});
		}
	}

	// reset the API key to the default value
	public async resetApiKey() {
		await vscode.commands.executeCommand("knuth_vsc.setOpenAIApiKey", "-");
		this.updateApiKeyState();
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this.webView = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this.context.extensionUri
			]
		};

		webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async data => {
			switch (data.type) {
				case 'addFreeTextQuestion':
					const apiRequestOptions = {
						command: "freeText",
						conversation: data.conversation ?? null,
						questionId: data.questionId ?? null,
						messageId: data.messageId ?? null,
					} as ApiRequestOptions;

					// if includeEditorSelection is true, add the code snippet to the question
					if (data?.includeEditorSelection) {
						const selection = this.getActiveEditorSelection();
						apiRequestOptions.code = selection?.content ?? "";
						apiRequestOptions.language = selection?.language ?? "";
					}

					this.sendApiRequest(data.value, apiRequestOptions);
					break;
				case 'editCode':
					const escapedString = (data.value as string).replace(/\$/g, '\\$');;
					vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(escapedString));

					this.logEvent("code-inserted");
					break;
				case 'setModel':
					this.model = data.value;
					await vscode.workspace.getConfiguration("knuth-vsc").update("gpt3.model", data.value, vscode.ConfigurationTarget.Global);
					this.logEvent("model-changed to " + data.value);
					break;
				case 'openNew':
					const document = await vscode.workspace.openTextDocument({
						content: data.value,
						language: data.language
					});
					vscode.window.showTextDocument(document);

					this.logEvent(data.language === "markdown" ? "code-exported" : "code-opened");
					break;
				case 'cleargpt3':
					// this.apiGpt3 = undefined;

					this.logEvent("gpt3-cleared");
					break;
				case 'openSettings':
					vscode.commands.executeCommand('workbench.action.openSettings', "@ext:aj-archipelago.knuth-vsc knuth-vsc.");

					this.logEvent("settings-opened");
					break;
				case 'openSettingsPrompt':
					vscode.commands.executeCommand('workbench.action.openSettings', "@ext:aj-archipelago.knuth-vsc promptPrefix");

					this.logEvent("settings-prompt-opened");
					break;
				case "stopGenerating":
					if (data?.conversationId) {
						this.stopGenerating(data.conversationId);
					} else {
						console.warn("Main Process - No conversationId provided to stop generating");
					}
					break;
				case "getSettings":
					this.sendMessage({
						type: "settingsUpdate",
						value: vscode.workspace.getConfiguration("knuth-vsc")
					});
					break;
				case "exportToMarkdown":
					// convert all messages in the conversation to markdown and open a new document with the markdown
					if (data?.conversation) {
						const markdown = this.convertMessagesToMarkdown(data.conversation);

						const markdownExport = await vscode.workspace.openTextDocument({
							content: markdown,
							language: 'markdown'
						});

						vscode.window.showTextDocument(markdownExport);
					} else {
						console.log("Main Process - No conversation to export to markdown");
					}
					break;
				case "getChatGPTModels":
					this.sendMessage({
						type: "chatGPTModels",
						value: this.chatGPTModels
					});
					break;
				case "changeApiKey":
					this.updateApiKeyState(data.value);
					break;
				case "getApiKeyStatus":
					this.updateApiKeyState();
					break;
				case "resetApiKey":
					this.resetApiKey();
					break;
				case "setVerbosity":
					const verbosity = data?.value ?? Verbosity.normal;
					vscode.workspace.getConfiguration("knuth-vsc").update("verbosity", verbosity, vscode.ConfigurationTarget.Global);
					break;
				case "setCurrentConversation":
					this.currentConversation = data.conversation;
					break;
				case 'getTokenCount':
					const convTokens = ApiProvider.countConversationTokens(data.conversation);
					let userInputTokens = ApiProvider.countMessageTokens({
						role: Role.user,
						content: data.conversation.userInput
					} as Message, data.conversation?.model ?? this.model ?? Model.gpt_35_turbo);

					// If "use editor selection" is enabled, add the tokens from the editor selection
					if (data?.useEditorSelection) {
						const selection = this.getActiveEditorSelection();
						// Roughly approximate the number of tokens used for the instructions about using the editor selection
						const roughApproxCodeSelectionContext = 40;

						userInputTokens += ApiProvider.countMessageTokens({
							role: Role.user,
							content: selection?.content ?? ""
						} as Message, data.conversation?.model ?? this.model ?? Model.gpt_35_turbo) + roughApproxCodeSelectionContext;
					}

					this.sendMessage({
						type: "tokenCount",
						tokenCount: {
							messages: convTokens,
							userInput: userInputTokens,
							maxTotal: Math.min(this._maxTokens, MODEL_TOKEN_LIMITS[(data.conversation?.model ?? this.model ?? Model.gpt_35_turbo) as Model]),
							minTotal: convTokens + userInputTokens,
						},
					});
					break;
				case 'runAction':
					const actionId: ActionNames = data.actionId as ActionNames;

					const controller = new AbortController();
					this.abortControllers.push({
						actionName: data.actionId,
						controller
					});

					try {
						await ActionRunner.runAction(actionId, this.api, this.systemContext, controller);
						this.sendMessage({
							type: "actionComplete",
							actionId,
						});
					} catch (error: any) {
						console.error("Main Process - Error running action: " + actionId);
						console.error(error);

						this.sendMessage({
							type: "actionError",
							actionId,
							error: error?.message ?? "Unknown error"
						});
					}

					break;
				case "stopAction":
					if (data?.actionId) {
						this.stopAction(data.actionId);
					} else {
						console.warn("Main Process - No actionName provided to stop action");
					}
					break;
				default:
					console.warn('Main Process - Uncaught message type: "' + data.type + '"');
					break;
			}
		});

		if (this.leftOverMessage !== null) {
			// If there were any messages that wasn't delivered, render after resolveWebView is called.
			this.sendMessage(this.leftOverMessage);
			this.leftOverMessage = null;
		}
	}
	private convertMessagesToMarkdown(conversation: Conversation): string {
		let markdown = conversation.messages.reduce((accumulator: string, message: Message) => {
			const role = message.role === Role.user ? "You" : "Knuth";
			const isError = message.isError ? "ERROR: " : "";
			const content = message.rawContent ?? message.content;

			// Add language to code blocks using highlight.js auto-detection
			const wrappedContent = hljs.highlightAuto(content).value;
			const formattedMessage = `<code>**${isError}[${role}]**</code>\n\`\`\`${wrappedContent}\`\`\`\n\n`;
			return accumulator + formattedMessage;
		}, "");

		return markdown;
	}

	private stopGenerating(conversationId: string): void {
		// Send the abort signal to the corresponding controller
		this.abortControllers.find((controller) => controller.conversationId === conversationId)?.controller.abort();
		// Remove abort controller from array
		this.abortControllers = this.abortControllers.filter((controller) => controller.conversationId !== conversationId);

		// show inProgress status update
		this.sendMessage({
			type: 'showInProgress',
			inProgress: false,
			conversationId,
		});
	}

	private stopAction(actionName: string): void {
		// Send the abort signal to the corresponding controller
		this.abortControllers.find((controller) => controller.actionName === actionName)?.controller.abort();
		// Remove abort controller from array
		this.abortControllers = this.abortControllers.filter((controller) => controller.actionName !== actionName);
	}

	private get isCodexModel(): boolean {
		return !!this.model?.startsWith("code-");
	}

	private async getApiKey(): Promise<string> {
		return await vscode.commands.executeCommand('knuth_vsc.getOpenAIApiKey') ?? '';
	}

	async isGoodApiKey(apiKey: string = ''): Promise<{
		valid: boolean,
		models?: any[],
	}> {
		if (!apiKey) {
			// Get OpenAI API key from secret store
			apiKey = await vscode.commands.executeCommand('knuth_vsc.getOpenAIApiKey') as string;
		}

		// If empty, return false
		if (!apiKey) {
			return {
				valid: false,
			};
		}

		let configuration = new Configuration({
			apiKey,
		});

		// if the organization id is set in settings, use it
		const organizationId = await vscode.workspace.getConfiguration("knuth-vsc").get("organizationId") as string;
		if (organizationId) {
			configuration.organization = organizationId;
		}

		// if the api base url is set in settings, use it
		const apiBaseUrl = await vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.apiBaseUrl") as string;
		if (apiBaseUrl) {
			configuration.basePath = apiBaseUrl;
		}

		try {
			const openai = new OpenAIApi(configuration);
			const response = await openai.listModels();

			return {
				valid: true,
				models: response.data?.data
			};
		} catch (error) {
			console.error('Main Process - Error getting models', error);
			return {
				valid: false,
			};
		}
	}

	async getModels(): Promise<any[]> {
		// Get OpenAI API key from secret store
		const apiKey = await vscode.commands.executeCommand('knuth_vsc.getOpenAIApiKey') as string;

		const configuration = new Configuration({
			apiKey,
		});

		// if the organization id is set in settings, use it
		const organizationId = await vscode.workspace.getConfiguration("knuth-vsc").get("organizationId") as string;
		if (organizationId) {
			configuration.organization = organizationId;
		}

		// if the api base url is set in settings, use it
		const apiBaseUrl = await vscode.workspace.getConfiguration("knuth-vsc").get("gpt3.apiBaseUrl") as string;
		if (apiBaseUrl) {
			configuration.basePath = apiBaseUrl;
		}

		try {
			const openai = new OpenAIApi(configuration);
			const response = await openai.listModels();

			return response.data?.data;
		} catch (error) {
			console.error('Main Process - Error getting models', error);
			return [];
		}
	}

	async getChatGPTModels(fullModelList: any[] = []): Promise<Model[]> {
		if (fullModelList?.length && fullModelList?.length > 0) {
			return fullModelList.filter((model: any) => ['gpt-3.5-turbo', 'gpt-3.5-turbo-16k', 'gpt-4', 'gpt-4-32k'].includes(model.id)).map((model: any) => {
				return model.id as Model;
			});
		} else {
			const models = await this.getModels();

			return models.filter((model: any) => ['gpt-3.5-turbo', 'gpt-3.5-turbo-16k', 'gpt-4', 'gpt-4-32k'].includes(model.id)).map((model: any) => {
				return model.id as Model;
			});
		}
	}

	private processQuestion(question: string, conversation: Conversation, code?: string, language?: string): string {
		let verbosity = '';
		switch (conversation.verbosity) {
			case Verbosity.code:
				verbosity = 'Do not include any explanations in your answer. Only respond with the code.';
				break;
			case Verbosity.concise:
				verbosity = 'Your explanations should be as concise and to the point as possible.';
				break;
			case Verbosity.full:
				verbosity = 'You should give full explanations that are as detailed as possible.';
				break;
		}

		if (code !== null && code !== undefined) {
			// If the language is not specified, get it from the active editor's language
			if (!language) {
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					language = editor.document.languageId;
				}
			}

			// if the language is still not specified, ask hljs to guess it
			if (!language) {
				const result = hljs.highlightAuto(code);
				language = result.language;
			}

			// Add prompt prefix to the code if there was a code block selected
			question = `${question}. ${verbosity} ${language ? ` The following code is in ${language} programming language.` : ''} Code in question:\n\n###\n\n\`\`\`${language}\n${code}\n\`\`\``;
		} else {
			question = `${question}. ${verbosity}`;
		}

		return question;
	}

	formatMessageContent(rawContent: string, markdown: boolean): string {
		return marked.parse(
			!markdown
				? "```\r\n" + unEscapeHTML(rawContent) + " \r\n ```"
				: (rawContent ?? "").split("```").length % 2 === 1
					? rawContent
					: rawContent + "\n\n```\n\n"
		);
	}


	public async sendApiRequest(prompt: string, options: ApiRequestOptions) {
		this.logEvent("api-request-sent", { "knuth-vsc.command": options.command, "knuth-vsc.hasCode": String(!!options.code) });
		const responseInMarkdown = !this.isCodexModel;

		// 1. First check if the conversation has any messages, if not add the system message
		if (options.conversation?.messages.length === 0) {
			options.conversation?.messages.push({
				id: uuidv4(),
				content: this.systemContext,
				rawContent: this.systemContext,
				role: Role.system,
				createdAt: Date.now(),
			});
		}

		// 2. Add the user's question to the conversation
		const formattedPrompt = this.processQuestion(prompt, options.conversation, options.code, options.language);
		if (options?.questionId) {
			// find the question in the conversation and update it
			const question = options.conversation?.messages.find((message) => message.id === options.questionId);
			if (question) {
				question.content = this.formatMessageContent(formattedPrompt, responseInMarkdown);
				question.rawContent = formattedPrompt;
				question.questionCode = options?.code
					? marked.parse(
						`\`\`\`${options?.language}\n${options.code}\n\`\`\``
					)
					: "";
			}
		} else {
			options.conversation?.messages.push({
				id: uuidv4(),
				content: formattedPrompt,
				rawContent: prompt,
				questionCode: options?.code
					? marked.parse(
						`\`\`\`${options?.language}\n${options.code}\n\`\`\``
					)
					: "",
				role: Role.user,
				createdAt: Date.now(),
			});
		}

		// 3. Tell the webview about the new messages
		this.sendMessage({
			type: 'messagesUpdated',
			messages: options.conversation?.messages,
			conversationId: options.conversation?.id ?? '',
		});

		// If the ChatGPT view is not in focus/visible; focus on it to render Q&A
		if (this.webView === null) {
			vscode.commands.executeCommand('knuth-vsc.view.focus');
		} else {
			this.webView?.show?.(true);
		}

		// Tell the webview that this conversation is in progress
		this.sendMessage({
			type: 'showInProgress',
			inProgress: true,
			conversationId: options.conversation?.id ?? '',
		});

		try {
			const message: Message = {
				// Normally random ID is generated, but when editing a question, the response update the same message
				id: options?.messageId ?? uuidv4(),
				content: '',
				rawContent: '',
				role: Role.assistant,
				createdAt: Date.now(),
			};

			// Initialize message in webview. Now event streaming only needs to update the message content
			if (options?.messageId) {
				this.sendMessage({
					type: 'updateMessage',
					message: message,
					conversationId: options.conversation?.id ?? '',
				});
			} else {
				this.sendMessage({
					type: 'addMessage',
					message: message,
				});
			}

			if (this.chatMode) {
				let lastMessageTime = 0;
				const controller = new AbortController();
				this.abortControllers.push({ conversationId: options.conversation?.id ?? '', controller });

				// Stream ChatGPT response (this is using an async iterator)
				for await (const token of this.api.streamChatCompletion(options.conversation, controller.signal, {
					maxTokens: options.maxTokens ?? this._maxTokens,
					temperature: options.temperature ?? this._temperature,
					topP: options.topP ?? this._topP,
				})) {
					message.rawContent += token;

					const now = Date.now();
					// Throttle the number of messages sent to the webview
					if (now - lastMessageTime > this.throttling) {
						message.content = this.formatMessageContent((message.rawContent ?? ''), responseInMarkdown);

						// Send webview updated message content
						this.sendMessage({
							type: 'streamMessage',
							conversationId: options.conversation.id ?? '',
							messageId: message.id,
							content: message.content,
						});

						lastMessageTime = now;
					}
				}

				// remove the abort controller
				this.abortControllers = this.abortControllers.filter((controller) => controller.conversationId !== options.conversation?.id);

				message.done = true;
				message.content = this.formatMessageContent(message.rawContent ?? "", responseInMarkdown);

				// Send webview full updated message
				this.sendMessage({
					type: 'updateMessage',
					conversationId: options.conversation.id ?? '',
					message: message,
				});
			} else {
				this.logEvent('chat-mode-off (not sending message)');
			}

			const hasContinuation = ((message.content.split("```").length) % 2) === 0;

			if (hasContinuation) {
				message.content = message.content + " \r\n ```\r\n";
				vscode.window.showInformationMessage("It looks like Knuth didn't complete their answer for your coding question. You can ask it to continue and combine the answers.", "Continue and combine answers")
					.then(async (choice) => {
						if (choice === "Continue and combine answers") {
							this.sendApiRequest("Continue", {
								command: options.command,
								conversation: options.conversation,
								code: undefined,
							});
						}
					});
			}

			if (this.subscribeToResponse) {
				vscode.window.showInformationMessage("Knuth responded to your question.", "Open conversation").then(async () => {
					await vscode.commands.executeCommand('knuth-vsc.view.focus');
				});
			}
		} catch (error: any) {
			let message;
			let apiMessage = error?.response?.data?.error?.message || error?.tostring?.() || error?.message || error?.name;

			console.error("api-request-failed info:", JSON.stringify(error, null, 2));
			console.error("api-request-failed error obj:", error);

			// For whatever reason error.status is undefined, but the below works
			const status = JSON.parse(JSON.stringify(error)).status ?? error?.status ?? error?.response?.status ?? error?.response?.data?.error?.status;

			switch (status) {
				case 400:
					message = `400 Bad Request\n\nYour model: '${this.model}' may be incompatible or one of your parameters is unknown. Reset your settings to default.`;
					break;
				case 401:
					message = '401 Unauthorized\n\nMake sure you are properly signed in. If you are using Browser Auto-login method, make sure the browser is open (You could refresh the browser tab manually if you face any issues, too). If you stored your API key in settings.json, make sure it is accurate. If you stored API key in session, you can reset it with `Knuth: Reset session` command. Potential reasons: \n- 1.Invalid Authentication\n- 2.Incorrect API key provided.\n- 3.Incorrect Organization provided. \n See https://platform.openai.com/docs/guides/error-codes for more details.';
					break;
				case 403:
					message = '403 Forbidden\n\nYour token has expired. Please try authenticating again.';
					break;
				case 404:
					message = `404 Not Found\n\n`;

					// For certain certain proxy paths, recommand a fix
					if (this.api.apiConfig.basePath?.includes("openai.1rmb.tk") && this.api.apiConfig.basePath !== "https://openai.1rmb.tk/v1") {
						message += "It looks like you are using the openai.1rmb.tk proxy server, but the path might be wrong.\nThe recommended path is https://openai.1rmb.tk/v1";
					} else {
						message += `If you've changed the API baseUrlPath, double-check that it is correct.\nYour model: '${this.model}' may be incompatible or you may have exhausted your ChatGPT subscription allowance.`;
					}
					break;
				case 429:
					message = "429 Too Many Requests\n\nToo many requests try again later. Potential reasons: \n 1. You exceeded your current quota, please check your plan and billing details\n 2. You are sending requests too quickly \n 3. The engine is currently overloaded, please try again later. \n See https://platform.openai.com/docs/guides/error-codes for more details.";
					break;
				case 500:
					message = "500 Internal Server Error\n\nThe server had an error while processing your request, please try again.\nSee https://platform.openai.com/docs/guides/error-codes for more details.";
					break;
				default:
					if (apiMessage) {
						message = `${status ? status + '\n\n' : ''}${apiMessage}`;
					} else {
						message = `${status}\n\nAn unknown error occurred. Please check your internet connection, clear the conversation, and try again.\n\n${apiMessage}`;
					}
			}

			this.sendMessage({
				type: 'addError',
				id: uuidv4(),
				conversationId: options.conversation.id,
				value: message,
			});

			return;
		} finally {
			this.sendMessage({
				type: 'showInProgress',
				conversationId: options.conversation.id,
				inProgress: false,
			});
		}
	}

	/**
	 * Message sender, stores if a message cannot be delivered
	 * @param message Message to be sent to WebView
	 * @param ignoreMessageIfNullWebView We will ignore the command if webView is null/not-focused
	 */
	public sendMessage(message: any, ignoreMessageIfNullWebView?: boolean) {
		if (this.webView) {
			this.webView?.webview.postMessage(message);
		} else if (!ignoreMessageIfNullWebView) {
			this.leftOverMessage = message;
		}
	}


	private logEvent(eventName: string, properties?: {}): void {
		console.debug(eventName, {
			// eslint-disable-next-line @typescript-eslint/naming-convention
			"knuth-vsc.model": this.model || "unknown", ...properties
		}, {
			"knuth-vsc.properties": properties,
		});
	}

	private logError(eventName: string): void {
		console.error(eventName, {
			// eslint-disable-next-line @typescript-eslint/naming-convention
			"knuth-vsc.model": this.model || "unknown"
		});
	}

	private getWebviewHtml(webview: vscode.Webview): string {
		//const vendorHighlightCss = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'highlight.min.css'));
		//const vendorHighlightJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'highlight.min.js'));
		//const vendorMarkedJs = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'marked.min.js'));
		// React code bundled by webpack, this includes styling
		const webpackScript = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.bundle.js'));

		const nonce = this.getRandomId();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
			</head>
			<body class="overflow-hidden">
				<div id="root" class="flex flex-col h-screen"></div>
				<script nonce="${nonce}" src="${webpackScript}"></script>
			</body>
			</html>`;
	}

	private getRandomId() {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}


	private getActiveEditorSelection(): {
		content: string;
		language: string;
	}
		| undefined {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			return;
		}

		const selection = editor.document.getText(editor.selection);
		const language = editor.document.languageId;

		return {
			content: selection,
			language
		};
	}
}
