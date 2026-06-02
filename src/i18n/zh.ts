/* eslint-disable */
import type { Messages } from './en';

export const zh: Messages = {
	plugin: {
		loading: 'Sync Confluence: 插件加载中...',
		loaded: 'Sync Confluence: 插件加载完成',
		unloaded: 'Sync Confluence: 插件已卸载',
		ribbonTooltip: '同步全部笔记到 Confluence',
	},

	notice: {
		noteNotOpen: '没有打开的笔记',
		fillAuthFirst: '请先在设置中填写 Confluence 认证信息',
		syncResult: 'Sync Confluence: {summary}',
		syncPartialFail: 'Sync Confluence 部分失败: {summary}',
		folderNoBoundNotes: '{folder} 下没有绑定的笔记',
		syncedNoChange: '无变化,跳过: {file}',
		syncedOk: '已同步: {file}',
		syncedFail: '同步失败: {file}\n{error}',
		frontmatterInserted: 'frontmatter 已插入,把 confluence_url 改为目标页面 URL',
		frontmatterInsertedShort: 'frontmatter 已插入',
		frontmatterAlreadyExists: '该笔记已有 confluence_url,跳过',
		frontmatterInsertedFileMenu: 'frontmatter 已插入,打开笔记把 confluence_url 改为目标页面 URL',
		authOk: '认证成功: {name}',
		authFail: '认证失败: {error}',
		templateWritten: '模板已写入',
		templateWriteFailed: '模板写入失败,查看控制台',
		exportPreviewOk: '已导出 storage 预览: {path}',
		exportPreviewFailed: '导出预览失败: {error}',
		pathRequired: '请填写笔记路径',
		urlRequired: '请填写 Confluence URL',
		urlCannotParsePageId: '无法从 URL 解析 page ID',
		createFailed: '创建失败: {error}',
	},

	summary: {
		all: '更新 {updated} / 跳过 {skipped} / 失败 {failed}',
		folder: '{folder}/: 更新 {updated} / 跳过 {skipped} / 失败 {failed}',
	},

	command: {
		syncAll: '同步全部笔记',
		syncCurrent: '同步当前笔记',
		insertTemplate: '在当前笔记插入 frontmatter',
		createBoundNote: '创建绑定笔记',
		exportStoragePreview: '导出当前笔记的 storage 预览',
		validateAuth: '验证认证信息',
	},

	menu: {
		syncToConfluence: '同步到 Confluence',
		insertFrontmatter: '插入 Confluence frontmatter',
		syncFolder: '同步到 Confluence(整个文件夹)',
	},

	status: {
		idle: '☁ 空闲',
		syncing: '☁ 同步中',
		success: '☁ 已同步',
		failed: '☁ 失败',
		tooltipIdle: 'Sync Confluence: 空闲{lastSuffix}',
		tooltipLastSync: ' - 最后同步: {time}',
		tooltipSyncing: 'Sync Confluence: 正在同步...',
		tooltipSuccess: 'Sync Confluence: 同步完成 - {time}',
		tooltipFailed: 'Sync Confluence: 同步失败',
		tooltipFailedWithError: '同步失败: {error}',
		syncingLabelPrefix: '☁ {text}',
	},

	settings: {
		section: {
			auth: 'Confluence 认证',
			schedule: '同步调度',
			scope: '扫描范围',
			template: '笔记模板',
			attachments: '附件',
			diagrams: '图表渲染(Mermaid / PlantUML)',
			ui: '通知与状态栏',
		},
		baseUrl: {
			name: 'Confluence base URL',
			desc: 'Cloud 形如 https://xxx.atlassian.net/wiki;Server 通常无 /wiki 后缀,如 https://confluence.your-corp.com',
		},
		authType: {
			name: '认证方式',
			desc: 'Basic:用户名 + 密码/API Token,适用于 Cloud(email+API token)与 Server 老账号体系(域账号+密码)。Bearer:Personal Access Token,适用于 Server 7.9+ / DC 启用 PAT 后,或 Cloud OAuth Bearer 令牌。',
			basic: 'Basic(用户名 + 密码/Token)',
			bearer: 'Bearer(Personal Access Token)',
		},
		username: {
			name: '账号(用户名 / 邮箱)',
			desc: 'Cloud 填 Atlassian 邮箱;Server 填域账号(如 duanzhang)',
			placeholder: 'you@example.com 或 域账号',
		},
		token: {
			nameBasic: '密码 / API Token',
			nameBearer: 'Personal Access Token',
			descBasic: '从下方下拉中选择已在密钥库中保存的密钥。Cloud 填 Atlassian API Token;Server 域账号体系填登录密码',
			descBearer: '从下方下拉中选择已在密钥库中保存的 PAT(Confluence 个人 → 设置 → Personal Access Tokens 创建)',
			placeholderSecretName: '密钥名称(需 Obsidian 1.11.4+ 密钥库)',
			hintLabel: '创建密钥:',
			hintBody: ' 设置 → 密钥库 → 创建新密钥;在 Atlassian 账户 → Security → API tokens 创建一个 token,粘贴为密钥值。',
		},
		validate: {
			button: '验证认证',
			pending: '验证中...',
			missingBasic: '请先填写 base URL / 账号 / Token',
			missingBearer: '请先填写 base URL / PAT',
			ok: '认证成功: {name}',
			fail: '认证失败: {error}',
			exception: '验证异常: {error}',
		},
		interval: {
			name: '定时同步间隔(分钟)',
			desc: '0 = 禁用定时,仅手动触发',
		},
		syncOnStartup: {
			name: '启动时同步一次',
			desc: 'Obsidian 启动 5 秒后自动跑一次全量同步',
		},
		syncNow: '立即同步全部',
		scanFolders: {
			name: '扫描目录(可选)',
			desc: '每行一个目录(相对 vault 根)。留空 = 扫描整个 vault',
		},
		ignore: {
			name: '忽略模式',
			desc: '每行一个 glob 模式,匹配的笔记跳过同步',
		},
		templateFolder: {
			name: '模板目录',
			desc: '模板文件存放路径(相对 vault 根)',
		},
		autoInstallTemplate: {
			name: '自动安装模板',
			desc: '插件加载时若模板目录不存在 confluence-note.md 则自动创建',
		},
		writeTemplateNow: '现在写入模板',
		uploadAttachments: {
			name: '上传本地附件',
			desc: '启用后,笔记里 ![[image.png]] 形式引用的本地图片会上传为 Confluence 附件',
		},
		maxAttachmentSize: {
			name: '附件大小上限(MB)',
			desc: '超过此大小的附件会被跳过',
		},
		diagramsIntro:
			'开启后,对应代码块会在本地或远端渲染为 PNG 并上传到 Confluence;关闭则原样推送代码块,由 Confluence 端 App 渲染或显示为源码。',
		mermaid: {
			toggleName: 'Mermaid → PNG',
			toggleDesc: 'POST mermaid 源码到下方 kroki 服务渲染为 PNG 上传(Confluence Server 不 inline 渲染 SVG,且本地 SVG→PNG 路径无中文字体支持)',
			urlName: 'Mermaid 渲染服务 URL',
			urlDesc: '完整 URL,默认 https://kroki.io/mermaid/png(公共实例);企业内网可自建 kroki docker 实例后改这里',
		},
		plantuml: {
			toggleName: 'PlantUML → PNG',
			toggleDesc: '通过 PlantUML Server 渲染(默认走 plantuml.com 公共实例,有速率限制)',
			urlName: 'PlantUML server URL',
			urlDesc: '不含尾部 /,例如 https://www.plantuml.com/plantuml 或自建实例',
		},
		showStatusBar: {
			name: '显示状态栏',
		},
		showNotice: {
			name: '显示通知',
			desc: '同步完成 / 失败时弹 Notice',
		},
		frontmatterKey: {
			name: 'frontmatter 字段名',
			desc: '高级选项:Confluence URL 在 frontmatter 中的字段名,默认 confluence_url',
		},
	},

	modal: {
		createBoundNote: {
			title: '创建绑定到 Confluence 的笔记',
			notePathName: '笔记路径',
			notePathDesc: '相对 vault 根的路径,自动补 .md',
			urlName: 'Confluence 页面 URL',
			urlDesc: '支持 /pages/{id}/ 与 ?pageId={id} 两种 URL 形式',
			cancel: '取消',
			create: '创建',
		},
		confirm: {
			cancel: '取消',
			defaultOk: '确定',
		},
	},

	template: {
		title: '# 标题',
		usage:
			'> 两种用法二选一:\n> 1. 已有 Confluence 页面 → 把目标页面 URL 填到 `confluence_url`\n> 2. 还没建页面 → 把父页面 URL 填到 `confluence_parent_url`,首次同步时插件会自动以本笔记文件名为标题创建子页面,并把新页面 URL 回写到 `confluence_url`\n> 其余字段(page_id / last_synced / last_hash)由插件自动维护。',
		bodyHeading: '## 正文',
		bodyPlaceholder: '在这里写内容...',
		syncingPlaceholder: '<p>(同步中...)</p>',
	},
};
