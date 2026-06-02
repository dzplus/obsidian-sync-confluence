/* eslint-disable */
// English UI strings. Keys are grouped by surface.
export const en = {
	// ===== Plugin-level =====
	plugin: {
		loading: 'Sync Confluence: loading…',
		loaded: 'Sync Confluence: loaded',
		unloaded: 'Sync Confluence: unloaded',
		ribbonTooltip: 'Sync all notes to Confluence',
	},

	// ===== Notices (transient toast messages) =====
	notice: {
		noteNotOpen: 'No active note',
		fillAuthFirst: 'Please fill in Confluence credentials in Settings first',
		syncResult: 'Sync Confluence: {summary}',
		syncPartialFail: 'Sync Confluence partial failure: {summary}',
		folderNoBoundNotes: 'No bound notes under {folder}',
		syncedNoChange: 'No change, skipped: {file}',
		syncedOk: 'Synced: {file}',
		syncedFail: 'Sync failed: {file}\n{error}',
		frontmatterInserted: 'Frontmatter inserted; set confluence_url to the target page URL',
		frontmatterInsertedShort: 'Frontmatter inserted',
		frontmatterAlreadyExists: 'This note already has a confluence_url, skipped',
		frontmatterInsertedFileMenu: 'Frontmatter inserted; open the note and set confluence_url to the target page URL',
		authOk: 'Authentication ok: {name}',
		authFail: 'Authentication failed: {error}',
		templateWritten: 'Template written',
		templateWriteFailed: 'Failed to write template, see console',
		exportPreviewOk: 'Storage preview exported: {path}',
		exportPreviewFailed: 'Failed to export preview: {error}',
		// CreateBoundNoteModal
		pathRequired: 'Please fill in the note path',
		urlRequired: 'Please fill in the Confluence URL',
		urlCannotParsePageId: 'Cannot parse page ID from URL',
		createFailed: 'Create failed: {error}',
	},

	// ===== Summary fragment (interpolated into notice.syncResult) =====
	summary: {
		all: 'updated {updated} / skipped {skipped} / failed {failed}',
		folder: '{folder}/: updated {updated} / skipped {skipped} / failed {failed}',
	},

	// ===== Commands =====
	command: {
		syncAll: 'Sync all notes',
		syncCurrent: 'Sync current note',
		insertTemplate: 'Insert Confluence frontmatter into current note',
		createBoundNote: 'Create bound note',
		exportStoragePreview: 'Export storage preview of current note',
		validateAuth: 'Validate credentials',
	},

	// ===== Context menus =====
	menu: {
		syncToConfluence: 'Sync to Confluence',
		insertFrontmatter: 'Insert Confluence frontmatter',
		syncFolder: 'Sync to Confluence (entire folder)',
	},

	// ===== Status bar =====
	status: {
		idle: '☁ Idle',
		syncing: '☁ Syncing',
		success: '☁ Synced',
		failed: '☁ Failed',
		tooltipIdle: 'Sync Confluence: idle{lastSuffix}',
		tooltipLastSync: ' — last sync: {time}',
		tooltipSyncing: 'Sync Confluence: syncing…',
		tooltipSuccess: 'Sync Confluence: synced — {time}',
		tooltipFailed: 'Sync Confluence: failed',
		tooltipFailedWithError: 'Sync failed: {error}',
		syncingLabelPrefix: '☁ {text}',
	},

	// ===== Settings tab =====
	settings: {
		section: {
			auth: 'Confluence authentication',
			schedule: 'Sync schedule',
			scope: 'Scan scope',
			template: 'Note template',
			attachments: 'Attachments',
			diagrams: 'Diagram rendering (Mermaid / PlantUML)',
			ui: 'Notifications and status bar',
		},
		baseUrl: {
			name: 'Confluence base URL',
			desc: 'Cloud looks like https://xxx.atlassian.net/wiki; Server usually has no /wiki suffix, e.g. https://confluence.your-corp.com',
		},
		authType: {
			name: 'Authentication type',
			desc: 'Basic: username + password/API token. Use this for Cloud (email + API token) and Server with classic accounts (domain account + password). Bearer: Personal Access Token. Use this for Server 7.9+ / DC with PAT enabled, or Cloud OAuth Bearer.',
			basic: 'Basic (username + password/token)',
			bearer: 'Bearer (Personal Access Token)',
		},
		username: {
			name: 'Account (username / email)',
			desc: 'Cloud: your Atlassian email. Server: your domain account (e.g. john.doe).',
			placeholder: 'you@example.com or domain account',
		},
		token: {
			nameBasic: 'Password / API token',
			nameBearer: 'Personal Access Token',
			descBasic: 'Pick a secret already stored in the key vault. Cloud uses an Atlassian API Token; Server with classic accounts uses the login password.',
			descBearer: 'Pick a PAT already stored in the key vault (create one at Confluence → Profile → Personal Access Tokens).',
			placeholderSecretName: 'Secret name (requires Obsidian 1.11.4+ key vault)',
			hintLabel: 'Create a secret:',
			hintBody: ' Settings → Key vault → Create new secret. Generate the token at Atlassian account → Security → API tokens and paste it as the secret value.',
		},
		validate: {
			button: 'Validate credentials',
			pending: 'Validating…',
			missingBasic: 'Please fill in base URL / account / token first',
			missingBearer: 'Please fill in base URL / PAT first',
			ok: 'Authentication ok: {name}',
			fail: 'Authentication failed: {error}',
			exception: 'Validation error: {error}',
		},
		interval: {
			name: 'Sync interval (minutes)',
			desc: '0 = disabled (manual only)',
		},
		syncOnStartup: {
			name: 'Sync once on startup',
			desc: 'Run a full sync 5 seconds after Obsidian launches',
		},
		syncNow: 'Sync all now',
		scanFolders: {
			name: 'Scan folders (optional)',
			desc: 'One folder per line, relative to vault root. Empty = scan the whole vault.',
		},
		ignore: {
			name: 'Ignore patterns',
			desc: 'One glob per line. Matching notes are skipped.',
		},
		templateFolder: {
			name: 'Template folder',
			desc: 'Where the template file is stored (relative to vault root)',
		},
		autoInstallTemplate: {
			name: 'Auto-install template',
			desc: 'On load, write confluence-note.md into the template folder if missing',
		},
		writeTemplateNow: 'Write template now',
		uploadAttachments: {
			name: 'Upload local attachments',
			desc: 'When enabled, ![[image.png]] embeds in notes are uploaded as Confluence attachments',
		},
		maxAttachmentSize: {
			name: 'Max attachment size (MB)',
			desc: 'Attachments larger than this are skipped',
		},
		diagramsIntro:
			'When enabled, matching code blocks are pre-rendered (locally or via a server) and uploaded as PNG attachments. When disabled, the code block is pushed as-is and rendered by a Confluence-side macro (or shown as source).',
		mermaid: {
			toggleName: 'Mermaid → PNG',
			toggleDesc: 'POSTs the Mermaid source to the kroki endpoint below and uploads the returned PNG (Confluence Server does not render inline SVG, and the local SVG→PNG path lacks CJK font support).',
			urlName: 'Mermaid render service URL',
			urlDesc: 'Full URL. Default https://kroki.io/mermaid/png (public instance); set this to a self-hosted kroki for corporate networks.',
		},
		plantuml: {
			toggleName: 'PlantUML → PNG',
			toggleDesc: 'Renders via a PlantUML server (defaults to the public plantuml.com instance, which is rate-limited)',
			urlName: 'PlantUML server URL',
			urlDesc: 'No trailing slash, e.g. https://www.plantuml.com/plantuml or a self-hosted instance',
		},
		showStatusBar: {
			name: 'Show status bar',
		},
		showNotice: {
			name: 'Show notices',
			desc: 'Pop a Notice when a sync finishes or fails',
		},
		frontmatterKey: {
			name: 'Frontmatter key name',
			desc: 'Advanced: the frontmatter field that holds the Confluence URL. Defaults to confluence_url.',
		},
	},

	// ===== Modals =====
	modal: {
		createBoundNote: {
			title: 'Create a note bound to Confluence',
			notePathName: 'Note path',
			notePathDesc: 'Path relative to vault root; .md is appended automatically',
			urlName: 'Confluence page URL',
			urlDesc: 'Supports both /pages/{id}/ and ?pageId={id} URL forms',
			cancel: 'Cancel',
			create: 'Create',
		},
		confirm: {
			cancel: 'Cancel',
			defaultOk: 'OK',
		},
	},

	// ===== Note template body (written into <vault>/templates/confluence-note.md) =====
	template: {
		title: '# Title',
		usage:
			'> Pick one of two flows:\n> 1. Existing Confluence page → put the page URL in `confluence_url`\n> 2. No page yet → put the **parent** page URL in `confluence_parent_url`. On first sync, the plugin will create a child page named after this note, then write the new URL back to `confluence_url`.\n> The other fields (page_id / last_synced / last_hash) are maintained automatically.',
		bodyHeading: '## Body',
		bodyPlaceholder: 'Write here…',
		syncingPlaceholder: '<p>(syncing…)</p>',
	},
};

export type Messages = typeof en;
