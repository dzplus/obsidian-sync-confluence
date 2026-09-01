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
		noteNotBound: 'Note is not bound to Confluence',
		fillAuthFirst: 'Please fill in Confluence credentials in Settings first',
		syncResult: 'Sync Confluence: {summary}',
		syncPartialFail: 'Sync Confluence partial failure: {summary}',
		syncFailed: 'Sync Confluence failed: {summary}',
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
		unmatchedUrl: 'No matching Confluence instance found for URL: {url}',
		urlDoesNotMatchInstance: 'URL does not match the selected instance ({instance}): {url}',
		instanceSummary: '{name}: updated {updated} / skipped {skipped} / failed {failed}',
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

	// ===== Properties-panel row actions =====
	propertyActions: {
		sync: 'Sync to Confluence',
		open: 'Open in Confluence',
	},

	// ===== Status bar =====
	status: {
		idle: '☁ Idle',
		syncing: '☁ Syncing',
		success: '☁ Synced',
		failed: '☁ Failed',
		partial: '☁ Partial',
		tooltipIdle: 'Sync Confluence: idle{lastSuffix}',
		tooltipLastSync: ' — last sync: {time}',
		tooltipSyncing: 'Sync Confluence: syncing…',
		tooltipSuccess: 'Sync Confluence: synced — {time}',
		tooltipFailed: 'Sync Confluence: failed',
		tooltipFailedWithError: 'Sync failed: {error}',
		tooltipPartial: 'Sync Confluence: partial — some instances failed',
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
		instances: {
			add: 'Add Confluence Instance',
			remove: 'Remove',
			moveUp: 'Move up',
			moveDown: 'Move down',
			id: 'Instance ID',
			idDesc: 'Stable key used by per-instance mention usernames and frontmatter caches',
			name: 'Instance name',
			nameDesc: 'A unique display name for this instance',
			duplicateName: 'Instance name must be unique',
			duplicateBaseUrl: 'Base URL must be unique',
			maxReached: 'Maximum of 10 instances reached — remove one before adding another',
		},
		baseUrl: {
			name: 'Confluence base URL',
			desc: 'Cloud looks like https://xxx.atlassian.net/wiki; Server usually has no /wiki suffix, e.g. https://confluence.your-corp.com',
			httpWarning: 'This URL uses http://. The API token will be sent in cleartext. Prefer https:// unless this is a trusted intranet Server.',
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
			placeholderPasteToken: 'Paste token here',
			savedLabel: 'Saved key: {key}',
			saveFailed: 'Failed to save token to key vault',
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
		stripSupplementary: {
			name: 'Legacy server compatibility: replace emoji with [U+XXXX]',
			desc: 'Only for Confluence Server whose MySQL still uses 3-byte utf8 (sync fails with "Unsupported character found in content"). Replaces emoji and other supplementary characters with [U+XXXX] placeholders. Leave off for Cloud and utf8mb4 servers — emoji sync natively.',
		},
		instanceSelect: {
			label: 'Confluence instance',
			desc: 'Select which instance to bind this note to',
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
		defaultImageWidth: {
			name: 'Default image display width (px)',
			desc: 'Display width for regular images after syncing to Confluence. Defaults to 192px; use 0 for original size. This does not resize the uploaded source file or affect Mermaid / PlantUML diagrams.',
		},
		diagramsIntro:
			'When enabled, matching code blocks are pre-rendered (locally or via a server) and uploaded as PNG attachments. When disabled, the code block is pushed as-is and rendered by a Confluence-side macro (or shown as source).',
		mermaid: {
			toggleName: 'Render Mermaid diagrams',
			toggleDesc: 'When enabled, mermaid code blocks are pre-rendered to image attachments before sync. When disabled, the mermaid source is pushed as-is and rendered by a Confluence-side macro (or shown as code).',
			rendererName: 'Renderer',
			rendererDesc: 'Both modes have trade-offs; pick by your Confluence version / network. Switching regenerates all mermaid attachments on next sync.',
			rendererKroki: 'Kroki remote service (PNG)',
			rendererObsidian: 'Obsidian built-in engine (SVG)',
			krokiPros: '✓ Pros: Full font coverage (CJK + emoji), best compatibility with older Confluence Server, identical render across devices.',
			krokiCons: '✗ Cons: Network-dependent (self-host needed on intranet); time-axis diagrams (gantt / timeline) render at a cramped width so date labels overlap.',
			krokiPrivacy: 'Privacy: mermaid source is sent to the configured Kroki server. The public kroki.io instance is a third party — use a self-hosted Kroki for confidential diagrams.',
			obsidianPros: '✓ Pros: Pixel-identical to the Obsidian preview, no network needed, mermaid version follows Obsidian, time-axis diagrams scale to content width.',
			obsidianCons: '✗ Cons: Output is SVG — Confluence Server 5.x and older may not render it inline; fonts follow your current theme, so remote viewers fall back to system defaults.',
			urlName: 'Kroki service URL',
			urlDesc: 'Full URL. Default https://kroki.io/mermaid/png (public instance); change to a self-hosted kroki for corporate networks. Change trailing /png to /svg to make kroki return SVG.',
		},
		plantuml: {
			toggleName: 'PlantUML → PNG',
			toggleDesc: 'Renders via a PlantUML server (defaults to the public plantuml.com instance, which is rate-limited)',
			urlName: 'PlantUML server URL',
			urlDesc: 'No trailing slash, e.g. https://www.plantuml.com/plantuml or a self-hosted instance',
			privacyWarning: 'Privacy: PlantUML source is sent to this server. The public plantuml.com instance is a third party — use a self-hosted server for confidential diagrams.',
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
				'> Pick one of two flows:\n> 1. Existing Confluence page → put the page URL in `confluence_url`\n> 2. No page yet → put the **parent** page URL in `confluence_parent_url` (supports array for multi-parent sync). On first sync, the plugin will create a child page named after this note, then write the new URL back to `confluence_url`.\n> The other fields (page_id / last_synced / last_hash) are maintained automatically.',
			bodyHeading: '## Body',
			bodyPlaceholder: 'Write here…',
			syncingPlaceholder: '<p>(syncing…)</p>',
		},
};

export type Messages = typeof en;
