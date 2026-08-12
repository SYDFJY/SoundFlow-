<template>
  <div class="settings-view">
    <div class="view-header">
      <button class="back-btn" @click="$router.back()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="header-title">设置</h1>
    </div>

    <div class="settings-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
      <input v-model="searchQuery" placeholder="搜索设置项…(如 歌词 / 字体 / 开机自启)" />
      <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">✕</button>
    </div>

    <div class="settings-content">
      <!-- 主题设置 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.appearance') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">{{ t('settings.theme') }}</span>
            <span class="label-desc">选择应用主题颜色</span>
          </div>
          <div class="theme-options">
            <button
              v-for="t in themeOptions"
              :key="t.value"
              class="theme-btn"
              :class="{ active: appStore.theme === t.value }"
              @click="appStore.applyTheme(t.value)"
            >
              <div class="theme-preview" :style="{ background: t.color }"></div>
              <span>{{ t.label }}</span>
            </button>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">启动自动续播</span>
            <span class="label-desc">打开应用后自动继续播放上次的歌曲</span>
          </div>
          <button class="switch" :class="{ on: appStore.autoPlay }" @click="toggleAutoPlay">
            <span class="switch-track"></span>
            <span>{{ appStore.autoPlay ? '已开启' : '已关闭' }}</span>
          </button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">跟随系统深色模式</span>
            <span class="label-desc">系统切换深色/浅色时自动切换主题(手动选主题将关闭此功能)</span>
          </div>
          <button class="switch" :class="{ on: appStore.followSystemTheme }" @click="appStore.setFollowSystemTheme(!appStore.followSystemTheme)">
            <span class="switch-track"></span>
            <span>{{ appStore.followSystemTheme ? '已开启' : '已关闭' }}</span>
          </button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">切歌通知</span>
            <span class="label-desc">切歌提示方式:应用内右下角卡片 / 系统通知横幅(默认卡片)</span>
          </div>
          <div class="notify-options">
            <button class="chip" :class="{ active: songNotify === 'off' }" @click="setSongNotify('off')">关闭</button>
            <button class="chip" :class="{ active: songNotify === 'card' }" @click="setSongNotify('card')">应用内卡片</button>
            <button class="chip" :class="{ active: songNotify === 'system' }" @click="setSongNotify('system')">系统横幅</button>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">{{ t('settings.language') }}</span>
            <span class="label-desc">Language / 界面语言</span>
          </div>          <div class="lang-options">
            <button class="chip" :class="{ active: currentLang === 'zh' }" @click="switchLang('zh')">简体中文</button>
            <button class="chip" :class="{ active: currentLang === 'en' }" @click="switchLang('en')">English</button>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">主题导入 / 导出</span>
            <span class="label-desc">Theme import / export</span>
          </div>
          <div class="theme-io-btns">
            <button class="btn--ghost" @click="exportTheme">导出当前主题</button>
            <button class="btn--ghost" @click="importTheme">导入主题</button>
          </div>
        </div>
      </div>

      <!-- 播放设置 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.playback') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">响度均衡</span>
            <span class="label-desc">ReplayGain — 换歌音量均衡(开启后后台分析,可能占用少量 CPU)</span>
          </div>
          <button class="switch" :class="{ on: playerStore.replayGainEnabled }" @click="toggleReplayGain">
            <span class="switch-track"></span>
            <span>{{ playerStore.replayGainEnabled ? '已开启' : '已关闭' }}</span>
          </button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">默认音量</span>
          </div>
          <div class="setting-control">
            <input type="range" min="0" max="1" step="0.01" :value="playerStore.volume" @input="e => playerStore.setVolume(parseFloat(e.target.value))" />
            <span class="volume-val">{{ Math.round(playerStore.volume * 100) }}%</span>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">播放结束</span>
            <span class="label-desc">一首歌播完后的行为</span>
          </div>
          <div class="setting-control" style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button class="chip chip--sm" :class="{ active: playerStore.endAction === 'next' }" @click="playerStore.setEndAction('next')">自动下一曲</button>
            <button class="chip chip--sm" :class="{ active: playerStore.endAction === 'stop' }" @click="playerStore.setEndAction('stop')">播完停止</button>
            <button class="chip chip--sm" :class="{ active: playerStore.endAction === 'fade' }" @click="playerStore.setEndAction('fade')">淡出后继续</button>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">播放模式</span>
          </div>
          <select :value="playerStore.playMode" @change="playerStore.setPlayMode($event.target.value)">
            <option value="list">列表播放</option>
            <option value="repeat">列表循环</option>
            <option value="repeatOne">单曲循环</option>
            <option value="random">随机播放</option>
          </select>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">倍速播放</span>
          </div>
          <div class="rate-options">
            <button v-for="r in rates" :key="r" class="chip chip--sm" :class="{ active: playerStore.playbackRate === r }" @click="playerStore.setPlaybackRate(r)">{{ r }}x</button>
          </div>
        </div>
      </div>

      <!-- 迷你播放器背景 -->
      <div class="settings-section">
        <h3 class="section-title">迷你播放器背景</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">背景样式</span>
            <span class="label-desc">文字颜色随背景亮度自动适配;透明模式小窗无底色</span>
          </div>
          <div class="mini-bg-options">
            <button class="chip chip--sm" :class="{ active: miniBgMode === 'dark' }" @click="setMiniBgMode('dark')">深色</button>
            <button class="chip chip--sm" :class="{ active: miniBgMode === 'white' }" @click="setMiniBgMode('white')">白色</button>
            <button class="chip chip--sm" :class="{ active: miniBgMode === 'custom' }" @click="setMiniBgMode('custom')">自定义</button>
            <button class="chip chip--sm" :class="{ active: miniBgMode === 'transparent' }" @click="setMiniBgMode('transparent')">透明</button>
          </div>
        </div>
        <div class="setting-item" v-if="miniBgMode === 'custom'">
          <div class="setting-label">
            <span class="label-text">自定义颜色</span>
          </div>
          <div class="setting-control">
            <input type="color" :value="miniBgColor" @input="e => setMiniBgMode('custom', e.target.value)" class="color-input" />
            <span class="volume-val">{{ miniBgColor }}</span>
          </div>
        </div>
        <div class="setting-item" v-if="miniBgMode === 'transparent'">
          <div class="setting-label">
            <span class="label-text">背景透明度</span>
            <span class="label-desc">底深程度 5%–80%,文字与按钮始终清晰</span>
          </div>
          <div class="setting-control">
            <input type="range" min="5" max="80" step="5" :value="Math.round(miniBgAlpha * 100)" @input="e => setMiniBgMode('transparent', null, parseInt(e.target.value) / 100)" />
            <span class="volume-val">{{ Math.round(miniBgAlpha * 100) }}%</span>
          </div>
        </div>
      </div>

      <!-- 扫描设置 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.library') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">扫描目录</span>
            <span class="label-desc">{{ musicStore.scanFolders.length }} 个目录</span>
          </div>
          <button class="btn" @click="addFolder">添加目录</button>
        </div>
        <div v-for="folder in musicStore.scanFolders" :key="folder" class="folder-item">
          <span class="folder-path text-ellipsis">{{ folder }}</span>
          <button class="remove-btn" @click="removeFolder(folder)">移除</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">自动刷新曲库</span>
            <span class="label-desc">监听扫描目录,新增/删除文件自动同步(事件驱动,无后台轮询)</span>
          </div>
          <button class="switch" :class="{ on: folderWatchOn }" @click="toggleFolderWatch">
            <span class="switch-track"></span>
            <span>{{ folderWatchOn ? '已开启' : '已关闭' }}</span>
          </button>
        </div>
      </div>

      <!-- 歌词文件夹 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.lyrics') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">在线歌词</span>
            <span class="label-desc">本地无 .lrc 时自动从所选来源获取同步歌词（需联网）</span>
          </div>
          <button class="switch" :class="{ on: onlineLyric }" @click="toggleOnlineLyric">
            <span class="switch-track"></span>
            <span>{{ onlineLyric ? '已开启' : '已关闭' }}</span>
          </button>
        </div>
        <div class="setting-item" v-if="onlineLyric">
          <div class="setting-label">
            <span class="label-text">歌词来源</span>
            <span class="label-desc">LRCLIB 免费开放；QQ 音乐中文覆盖广；网易云中文较全；自动 = LRCLIB 优先，失败再 QQ 音乐 → 网易云</span>
          </div>
          <div class="lyric-source-group">
            <button v-for="opt in lyricSources" :key="opt.value" class="chip" :class="{ active: lyricSource === opt.value }" @click="setLyricSource(opt.value)">{{ opt.label }}</button>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">歌词翻译服务</span>
            <span class="label-desc">MyMemory 免费（并发，稍慢）；DeepSeek 整首一次翻译（快、质量好，需 API Key）</span>
          </div>
          <div class="lyric-source-group">
            <button class="chip" :class="{ active: translateService === 'mymemory' }" @click="setTranslateService('mymemory')">MyMemory</button>
            <button class="chip" :class="{ active: translateService === 'deepseek' }" @click="setTranslateService('deepseek')">DeepSeek</button>
          </div>
          <div v-if="translateService === 'deepseek'" class="deepseek-key-row">
            <input v-model="deepseekKey" :type="showDeepseekKey ? 'text' : 'password'" class="deepseek-key-input" :placeholder="deepseekKey ? '已配置(输入可更换)' : '输入 DeepSeek API Key(仅保存在本地)'" @blur="saveDeepseekKey" />
            <button class="key-eye" @click="showDeepseekKey = !showDeepseekKey" :title="showDeepseekKey ? '隐藏' : '显示'">{{ showDeepseekKey ? '🙈' : '👁' }}</button>
            <span v-if="deepseekKey" class="key-configured">已配置 ✓</span>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">歌词文件夹</span>
            <span class="label-desc">独立存放 .lrc 文件，按文件名自动匹配歌曲</span>
          </div>
          <button class="btn" @click="addLyricFolder">添加文件夹</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">批量下载歌词</span>
            <span class="label-desc">遍历曲库所有歌曲，将没有本地 .lrc 的歌从在线来源（LRCLIB / QQ 音乐 / 网易云）下载到歌词文件夹</span>
          </div>
          <button class="btn" :disabled="batchLyric.running" @click="batchDownloadLyrics">
            {{ batchLyric.running ? `下载中 ${batchLyric.done}/${batchLyric.total}` : '开始批量下载' }}
          </button>
        </div>
        <div v-if="batchLyric.running" class="setting-item">
          <div class="batch-progress-track">
            <div class="batch-progress-fill" :style="{ width: (batchLyric.total ? (batchLyric.done / batchLyric.total * 100) : 0) + '%' }"></div>
          </div>
          <span class="label-text" style="color:var(--text-secondary);font-size: var(--font-size-xs);margin-top:6px;">
            成功 {{ batchLyric.success }} · 已有 {{ batchLyric.skipped }} · 失败 {{ batchLyric.failed }}
          </span>
        </div>
        <div v-if="!batchLyric.running && batchLyric.msg" class="setting-item">
          <div class="setting-label">
            <span class="label-text" style="color:var(--text-secondary);">{{ batchLyric.msg }}</span>
          </div>
        </div>

        <!-- 下载完成弹窗 -->
        <teleport to="body">
          <transition name="fade">
            <div v-if="batchLyric.showResult" class="batch-done-overlay" @click.self="batchLyric.showResult = false">
              <div class="batch-done-card">
                <div class="done-icon">✅</div>
                <h3>歌词下载完成</h3>
                <div class="done-row">成功下载 <b>{{ batchLyric.success }}</b> 首 &nbsp;·&nbsp; 已有 <b>{{ batchLyric.skipped }}</b> 首</div>
                <div class="done-row" v-if="batchLyric.matchFail || batchLyric.saveFail || batchLyric.failed">未匹配 <b>{{ batchLyric.matchFail }}</b> 首 · 写入失败 <b>{{ batchLyric.saveFail }}</b> 首 · 其他失败 <b>{{ batchLyric.failed }}</b> 首</div>
                <div class="done-row muted">用时 {{ batchLyric.elapsed }} · 完成时间 {{ batchLyric.finishedAt }}</div>
                <div class="done-folder" :title="batchLyric.folder">下载到：{{ batchLyric.folder }}</div>
                <div class="done-btns">
                  <button class="btn" @click="openLyricFolder">📂 打开歌词文件夹</button>
                  <button class="btn--ghost btn--sm" @click="batchLyric.showResult = false">关闭</button>
                </div>
              </div>
            </div>
          </transition>
        </teleport>
        <div v-if="musicStore.lyricFolders.length === 0" class="folder-item" style="color:var(--text-tertiary);font-size: var(--font-size-sm);">
          暂未设置歌词文件夹（歌词也可放在歌曲同目录同名 .lrc 自动识别）
        </div>
        <div v-for="folder in musicStore.lyricFolders" :key="folder" class="folder-item">
          <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--color-primary);flex-shrink:0"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span class="folder-path text-ellipsis">{{ folder }}</span>
          <button class="remove-btn" @click="removeLyricFolder(folder)">移除</button>
        </div>
      </div>

      <!-- 音效 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.eq') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">均衡器 / 音效</span>
            <span class="label-desc">10 段 EQ + 预设 + 重低音 + 空间声场(Web Audio 实时处理)</span>
          </div>
          <button class="switch" :class="{ on: playerStore.eqSettings.enabled }" @click="playerStore.setEqEnabled(!playerStore.eqSettings.enabled)">
            <span class="switch-track"></span>
            <span>{{ playerStore.eqSettings.enabled ? '已开启' : '已关闭' }}</span>
          </button>
        </div>
        <div v-if="playerStore.eqSettings.enabled" class="eq-area">
          <div class="eq-presets">
            <button v-for="(p, key) in playerStore.EQ_PRESETS" :key="key" class="source-btn eq-preset-btn" :class="{ active: playerStore.eqSettings.preset === key }" @click="playerStore.setEqPreset(key)">{{ p.name }}</button>
          </div>
          <div class="eq-sliders">
            <div v-for="(f, i) in playerStore.EQ_FREQS" :key="f" class="eq-slider-col">
              <span class="eq-gain">{{ playerStore.eqSettings.gains[i] > 0 ? '+' : '' }}{{ playerStore.eqSettings.gains[i] }}</span>
              <input type="range" min="-12" max="12" step="1" :value="playerStore.eqSettings.gains[i]" @input="playerStore.setEqGain(i, parseInt($event.target.value))" />
              <span class="eq-freq">{{ f >= 1000 ? (f / 1000) + 'k' : f }}</span>
            </div>
          </div>
          <div class="eq-extra">
            <div class="eq-extra-item">
              <span class="label-text">重低音</span>
              <input type="range" min="-6" max="12" step="1" :value="playerStore.eqSettings.bass" @input="playerStore.setBass(parseInt($event.target.value))" />
            </div>
            <div class="eq-extra-item">
              <span class="label-text">空间声场</span>
              <input type="range" min="0" max="1" step="0.05" :value="playerStore.eqSettings.reverb" @input="playerStore.setReverb(parseFloat($event.target.value))" />
            </div>
          </div>
        </div>
      </div>

      <!-- 字体 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.font') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">界面字体</span>
            <span class="label-desc">可导入 .ttf / .otf / .woff2 字体文件</span>
          </div>
        </div>
        <div class="setting-item font-row">
          <select class="font-select" :value="currentFont" @change="selectFont($event.target.value)">
            <option v-for="f in systemFonts" :key="f.value" :value="f.value">{{ f.label }}</option>
            <option v-for="f in customFonts" :key="f.url" :value="'&quot;' + f.name + '&quot;'">{{ f.name }}（自定义）</option>
          </select>
          <button class="btn" @click="importFont">导入字体</button>
          <button class="btn" @click="importFontFolder">字体文件夹</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">字体大小</span>
          </div>
          <div class="font-size-row">
            <input type="range" min="10" max="24" step="1" :value="appStore.fontSize" @input="appStore.setFontSize(parseInt($event.target.value))" />
            <span class="volume-val">{{ appStore.fontSize }}px</span>
          </div>
        </div>
        <div class="setting-item" v-if="customFonts.length">
          <div class="setting-label"><span class="label-text">字体文件夹字体(点击应用)</span></div>
          <div class="font-pick-grid">
            <button
              v-for="(f, i) in customFonts"
              :key="f.url"
              class="font-pick-card"
              :class="{ active: currentFont.includes(f.name) }"
              :style='{ fontFamily: "\"" + f.name + "\"" }'
              @click="selectFont('&quot;' + f.name + '&quot;')"
            >{{ f.name }}</button>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label font-collapse" @click="fontExpanded = !fontExpanded">
            <span class="label-text">已导入字体({{ customFonts.length }})</span>
            <span class="collapse-arrow">{{ fontExpanded ? '▾' : '▸' }}</span>
          </div>
          <div v-show="fontExpanded" class="font-expand-list">
            <div v-for="(f, i) in customFonts" :key="f.url" class="custom-font-row">
              <span class="font-name" :style='{ fontFamily: "\"" + f.name + "\"" }'>{{ f.name }}</span>
              <button class="btn font-remove" @click="removeCustomFont(i)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 快捷键 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.shortcuts') }}</h3>
        <div class="shortcut-overview">
          <div v-for="d in shortcutDefs" :key="d.key" class="sc-item">
            <kbd>{{ shortcuts[d.key] || '未设置' }}</kbd>
            <span class="sc-label">{{ d.label }}</span>
          </div>
        </div>
        <div class="setting-item" v-for="d in shortcutDefs" :key="d.key">
          <div class="setting-label">
            <span class="label-text">{{ d.label }}</span>
          </div>
          <button class="btn" :class="{ recording: recordingKey === d.key }" @click="startRecord(d.key)" @keydown="onRecordKey">
            {{ recordingKey === d.key ? '按新快捷键…' : (shortcuts[d.key] || '未设置') }}
          </button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">恢复默认快捷键</span>
            <span class="label-desc">空格播放/暂停、Ctrl+←/→ 切歌、Ctrl+↑/↓ 音量</span>
          </div>
          <button class="btn" @click="resetShortcuts">恢复默认</button>
        </div>
      </div>

      <!-- 关闭行为 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.system') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">开机自启</span>
            <span class="label-desc">Start with Windows</span>
          </div>
          <button class="switch" :class="{ on: loginItem }" @click="toggleLoginItem">
            <span class="switch-track"></span>
            <span>{{ loginItem ? '已开启' : '已关闭' }}</span>
          </button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">关闭窗口时</span>
          </div>
          <select v-model="closeAction">
            <option value="minimize">最小化到托盘</option>
            <option value="exit">退出应用</option>
          </select>
        </div>
      </div>

      <!-- 数据安全 -->
      <div class="settings-section">
        <h3 class="section-title">🛡️ 数据安全</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">自动备份</span>
            <span class="label-desc">每次启动自动备份全部数据(收藏/歌单/设置/播放记录),保留最近 10 份,存放于用户数据目录 backups/ 文件夹</span>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">手动备份</span>
            <span class="label-desc">导出/导入完整数据备份(下方「数据」区),可用于换机迁移或数据损坏后恢复</span>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">标签备份(可回滚)</span>
            <span class="label-desc">修改歌曲信息(写回标签)前自动备份原文件,可一键还原;每首歌保留最近 3 份</span>
          </div>
          <div v-if="tagBackups.length" class="tag-backup-list">
            <div v-for="b in tagBackups.slice(0, 20)" :key="b.id" class="tag-backup-row">
              <span class="tag-backup-name" :title="b.filePath">{{ b.name }}</span>
              <span class="tag-backup-time">{{ new Date(b.time).toLocaleString().slice(5, 16) }}</span>
              <button class="sec-btn" @click="restoreTag(b)">还原</button>
            </div>
            <div class="tag-backup-actions">
              <button class="sec-btn" @click="clearTagBackups">清空全部备份</button>
            </div>
          </div>
          <span v-else class="label-desc">暂无标签备份(修改歌曲信息后自动生成)</span>
        </div>
      </div>

      <!-- 关于 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.about') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">检查更新</span>
            <span class="label-desc">Check for updates</span>
          </div>
          <button class="sec-btn" :disabled="checkingUpdate" @click="checkUpdate">{{ checkingUpdate ? '检查中…' : updateMsg || '检查更新' }}</button>
        </div>
        <div class="about-card">
          <div class="about-logo">
            <img src="/icon.jpg" alt="logo" style="width:48px;height:48px;border-radius:12px;object-fit:cover;" />
          </div>
          <div class="about-info">
            <h4>SoundFlow 声流音乐</h4>
            <span>版本 1.0.0</span>
            <p>纯本地音乐播放器，畅享无损音质</p>
          </div>
        </div>
      </div>

      <!-- 数据 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.data') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">备份数据</span>
            <span class="label-desc">导出曲库、歌单、收藏、播放历史与设置到 JSON 文件，重装/换机不丢数据</span>
          </div>
          <button class="btn" :disabled="backupBusy" @click="exportBackup">{{ backupBusy ? '处理中…' : '导出备份' }}</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">导入备份</span>
            <span class="label-desc">从备份 JSON 恢复全部数据（将覆盖当前数据，导入后自动重启应用）</span>
          </div>
          <button class="btn" :disabled="backupBusy" @click="importBackup">{{ backupBusy ? '处理中…' : '导入备份' }}</button>
        </div>
        <div v-if="backupMsg" class="setting-item">
          <span class="label-text" :style="{ color: backupOk ? 'var(--color-primary)' : 'var(--color-danger)' }">{{ backupMsg }}</span>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">存储占用</span>
            <span class="label-desc">封面缓存:{{ storageInfo.coversCount || 0 }} 张 · {{ storageInfo.coversSize ? (storageInfo.coversSize / 1048576).toFixed(1) : '0.0' }} MB（清理后播放歌曲时自动重新生成）</span>
          </div>
          <button class="btn" @click="clearCache" :disabled="cacheBusy">{{ cacheBusy ? '清理中…' : '清理封面缓存' }}</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">本地歌词管理</span>
            <span class="label-desc">查看歌曲本地歌词状态,删除不需要的歌词文件</span>
          </div>
          <button class="btn" @click="openLyricManager">打开管理</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 本地歌词管理弹窗 -->
  <div v-if="lyricMgrOpen" class="save-queue-mask" @click.self="lyricMgrOpen = false">
    <div class="save-queue-card lyric-mgr-card">
      <h3>本地歌词管理</h3>
      <div class="lyric-mgr-stats" v-if="!lyricMgrBusy">
        共 {{ filteredSongs.length }} 首 · <span style="color:var(--color-primary)">有歌词 {{ withLyricCount }}</span> · <span style="color:#ff8f8f">缺失 {{ filteredSongs.length - withLyricCount }}</span>
      </div>
      <div class="lyric-mgr-stats" v-else>正在扫描歌词状态…</div>
      <input v-model="lyricMgrSearch" class="eq-name-input" placeholder="搜索歌曲 / 歌手…" />
      <div class="lyric-mgr-list">
        <div v-for="s in filteredSongs" :key="s.path" class="lyric-mgr-row">
          <div class="lyric-mgr-info">
            <div class="lyric-mgr-title text-ellipsis">{{ s.title }}</div>
            <div class="lyric-mgr-artist text-ellipsis">{{ s.artist }}</div>
          </div>
          <span class="lyric-mgr-status" :class="{ ok: lyricStatus[s.path] }">{{ lyricStatus[s.path] ? '✓ 有' : '✗ 无' }}</span>
          <button v-if="lyricStatus[s.path]" class="lyric-mgr-del" @click="deleteMgrLyric(s)" title="删除本地歌词">🗑</button>
        </div>
        <div v-if="!filteredSongs.length" class="rank-empty">无匹配歌曲</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { t, i18n, setLang } from '@/i18n'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'

const appStore = useAppStore()
function toggleReplayGain() {
  const v = !playerStore.replayGainEnabled
  playerStore.setReplayGainEnabled(v)
  if (v && window.electronAPI && window.electronAPI.pushLoudnessBatch) {
    // 开启:后台批量分析曲库(串行慢速,不阻塞播放)
    window.electronAPI.pushLoudnessBatch((musicStore.songs || []).map(s => s.path))
    window.$toast?.('响度均衡已开启,正在后台分析音量…', 'info')
  } else if (window.electronAPI && window.electronAPI.stopLoudnessBatch) {
    window.electronAPI.stopLoudnessBatch()
    window.$toast?.('响度均衡已关闭', 'info')
  }
}
async function exportTheme() {
  try {
    const json = appStore.exportThemeJSON()
    if (window.electronAPI && window.electronAPI.saveThemeFile) {
      const ok = await window.electronAPI.saveThemeFile(json)
      window.$toast?.(ok ? '主题已导出 ✓' : '已取消导出', ok ? 'success' : 'info')
    }
  } catch { window.$toast?.('导出失败', 'error') }
}
async function importTheme() {
  try {
    if (window.electronAPI && window.electronAPI.openThemeFile) {
      const content = await window.electronAPI.openThemeFile()
      if (!content) return
      const ok = appStore.importThemeJSON(content)
      window.$toast?.(ok ? '主题已导入并应用 ✓' : '主题文件格式无效', ok ? 'success' : 'warning')
    }
  } catch { window.$toast?.('导入失败', 'error') }
}
const loginItem = ref(false)
async function loadLoginItem() {
  try { if (window.electronAPI && window.electronAPI.getLoginItem) loginItem.value = await window.electronAPI.getLoginItem() } catch {}
}
// 导出全部数据(收藏/歌单/设置/播放记录)到用户选择的文件
async function exportData() {
  if (!window.electronAPI?.exportDataFile) return
  try {
    const data = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      data[k] = localStorage.getItem(k)
    }
    const r = await window.electronAPI.exportDataFile(data)
    if (r?.ok) window.$toast?.(`✅ 数据已导出到:\n${r.path}`, 'success', 4200)
    else if (r && !r.canceled) window.$toast?.('导出失败: ' + (r.error || '未知错误'), 'error')
  } catch (e) { window.$toast?.('导出失败: ' + e.message, 'error') }
}
// 导入数据备份(写入 localStorage + store,重启生效)
async function importData() {
  if (!window.electronAPI?.importDataFile) return
  try {
    const r = await window.electronAPI.importDataFile()
    if (!r) return
    if (!r.ok) { if (!r.canceled) window.$toast?.(r.error || '导入失败', 'error'); return }
    for (const [k, v] of Object.entries(r.localStorage || {})) {
      try { localStorage.setItem(k, v) } catch {}
    }
    if (Object.keys(r.store || {}).length && window.electronAPI.storeSetBulk) {
      await window.electronAPI.storeSetBulk(r.store).catch(() => {})
    }
    window.$toast?.('✅ 数据已导入,请重启应用生效', 'success', 4200)
  } catch (e) { window.$toast?.('导入失败: ' + e.message, 'error') }
}

async function toggleLoginItem() {
  const v = !loginItem.value
  loginItem.value = v
  try { if (window.electronAPI && window.electronAPI.setLoginItem) await window.electronAPI.setLoginItem(v) } catch {}
  window.$toast?.(v ? '已开启开机自启' : '已关闭开机自启', 'success')
}
loadLoginItem()
const searchQuery = ref('')
function applySearch(q) {
  const qq = (q || '').trim().toLowerCase()
  document.querySelectorAll('.settings-section').forEach(sec => {
    let any = false
    sec.querySelectorAll('.setting-item').forEach(item => {
      const text = (item.textContent || '').toLowerCase()
      const hit = !qq || text.includes(qq)
      item.style.display = hit ? '' : 'none'
      if (hit) any = true
    })
    sec.style.display = (!qq || any) ? '' : 'none'
  })
}
watch(searchQuery, applySearch)
const currentLang = computed(() => i18n.lang)
// 检查更新(自动更新骨架;未配置发布源时提示)
const checkingUpdate = ref(false)
const updateMsg = ref('')
async function checkUpdate() {
  checkingUpdate.value = true
  updateMsg.value = ''
  try {
    if (!window.electronAPI || !window.electronAPI.checkUpdates) { updateMsg.value = '开发模式不可用'; return }
    const r = await window.electronAPI.checkUpdates()
    if (r.ok && r.hasUpdate) updateMsg.value = '发现新版本,请到发布页下载'
    else if (r.ok) updateMsg.value = '已是最新版本'
    else updateMsg.value = r.msg || '检查失败'
  } catch { updateMsg.value = '检查失败' } finally { checkingUpdate.value = false }
}
function switchLang(l) { setLang(l); appStore.saveSettings() }
const musicStore = useMusicStore()
const playerStore = usePlayerStore()

// ===== 数据备份 / 导入 =====
const backupBusy = ref(false)
// 存储占用与清理
const storageInfo = ref({ coversCount: 0, coversSize: 0 })
const cacheBusy = ref(false)
async function loadStorageInfo() {
  try {
    if (window.electronAPI?.getStorageInfo) storageInfo.value = await window.electronAPI.getStorageInfo()
  } catch {}
}
loadStorageInfo()
async function clearCache() {
  if (cacheBusy.value) return
  cacheBusy.value = true
  try {
    const r = await window.electronAPI?.clearCoverCache?.()
    try { window.$toast?.(`已清理 ${r?.removed || 0} 个封面缓存文件`, 'success') } catch {}
  } catch {
    try { window.$toast?.('清理失败', 'error') } catch {}
  }
  cacheBusy.value = false
  loadStorageInfo()
}

// 本地歌词管理
const lyricMgrOpen = ref(false)
const lyricMgrSearch = ref('')
const lyricStatus = ref({})
const lyricMgrBusy = ref(false)

// Esc 关闭弹窗
function onSettingsEsc() { lyricMgrOpen.value = false }
onMounted(() => document.addEventListener('soundflow:esc', onSettingsEsc))
onUnmounted(() => document.removeEventListener('soundflow:esc', onSettingsEsc))
const filteredSongs = computed(() => {
  const q = lyricMgrSearch.value.trim().toLowerCase()
  const list = musicStore.songs || []
  if (!q) return list
  return list.filter(s => (s.title || '').toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q))
})
const withLyricCount = computed(() => filteredSongs.value.filter(s => lyricStatus.value[s.path]).length)
async function scanLyricStatusAll() {
  if (!window.electronAPI?.scanLyricStatus || !musicStore.songs.length) return
  lyricMgrBusy.value = true
  try {
    const songs = musicStore.songs.slice(0, 500).map(s => ({ path: s.path }))
    const r = await window.electronAPI.scanLyricStatus(songs, [...musicStore.lyricFolders])
    lyricStatus.value = r || {}
  } catch {}
  lyricMgrBusy.value = false
}
async function openLyricManager() {
  lyricMgrOpen.value = true
  await scanLyricStatusAll()
}
async function deleteMgrLyric(s) {
  if (!window.electronAPI?.deleteLyricFile) return
  try {
    await window.electronAPI.deleteLyricFile(s.path, [...musicStore.lyricFolders])
    lyricStatus.value[s.path] = false
    try { window.$toast?.('已删除「' + s.title + '」的本地歌词', 'success') } catch {}
  } catch {
    try { window.$toast?.('删除失败', 'error') } catch {}
  }
}
const backupMsg = ref('')
const backupOk = ref(false)
async function exportBackup() {
  backupBusy.value = true
  backupMsg.value = ''
  try {
    const filePath = await window.electronAPI.exportBackup()
    if (filePath) {
      backupOk.value = true
      backupMsg.value = `已导出到 ${filePath}`
      window.$toast?.('备份导出成功', 'success')
    } else {
      backupMsg.value = '已取消导出'
    }
  } catch (e) {
    backupOk.value = false
    backupMsg.value = '导出失败: ' + e.message
  } finally {
    backupBusy.value = false
  }
}
async function importBackup() {
  backupBusy.value = true
  backupMsg.value = ''
  try {
    const res = await window.electronAPI.importBackup()
    if (res && res.ok) {
      backupOk.value = true
      backupMsg.value = '导入成功，正在重启应用…'
      window.$toast?.('数据恢复成功，正在重启', 'success')
      setTimeout(() => window.electronAPI.restartApp(), 1200)
    } else if (res && res.cancel) {
      backupMsg.value = '已取消导入'
    } else {
      backupOk.value = false
      backupMsg.value = '导入失败: 文件格式不正确或数据无效'
    }
  } catch (e) {
    backupOk.value = false
    backupMsg.value = '导入失败: ' + e.message
  } finally {
    backupBusy.value = false
  }
}
const closeAction = computed({
  get: () => appStore.closeAction,
  set: (val) => { appStore.closeAction = val; appStore.saveSettings() }
})
const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0]
// 标签备份管理(写回前自动备份,可回滚)
const tagBackups = ref([])
async function loadTagBackups() {
  try { tagBackups.value = (await window.electronAPI.listTagBackups()) || [] } catch { tagBackups.value = [] }
}
async function restoreTag(b) {
  if (!confirm(`还原「${b.name}」到修改标签前的版本?\n当前文件将被备份副本覆盖(仅恢复该文件)`)) return
  const r = await window.electronAPI.restoreTagBackup(b.id)
  if (r && r.ok) { window.$toast?.('已还原原文件', 'success'); loadTagBackups() }
  else { window.$toast?.(r?.error || '还原失败', 'error') }
}
async function clearTagBackups() {
  if (!confirm('确定清空全部标签备份?清空后无法再还原到旧标签')) return
  const r = await window.electronAPI.clearTagBackups()
  if (r && r.ok) { window.$toast?.('已清空', 'success'); tagBackups.value = [] }
  else { window.$toast?.(r?.error || '清空失败', 'error') }
}

// ===== 迷你播放器背景(深色/白色/自定义/透明) =====
const miniBgMode = ref(localStorage.getItem('soundflow_mini_bg_mode') || 'dark')
const miniBgColor = ref(localStorage.getItem('soundflow_mini_bg_color') || '#161b22')
const miniBgAlpha = ref(parseFloat(localStorage.getItem('soundflow_mini_bg_alpha')) || 0.05)
function setMiniBgMode(mode, color, alpha) {
  miniBgMode.value = mode
  if (color) miniBgColor.value = color
  if (typeof alpha === 'number') miniBgAlpha.value = alpha
  localStorage.setItem('soundflow_mini_bg_mode', mode)
  localStorage.setItem('soundflow_mini_bg_color', miniBgColor.value)
  localStorage.setItem('soundflow_mini_bg_alpha', String(miniBgAlpha.value))
  // 通知主进程:迷你窗开着则重建(带新窗口参数)
  try { window.electronAPI?.send('mini:bg-changed', { mode, color: miniBgColor.value, alpha: miniBgAlpha.value }) } catch (_) {}
}
// 迷你窗右键菜单修改后同步设置页状态
onMounted(() => {
  loadTagBackups()
  document.addEventListener('mini-bg-synced', (e) => {
    const cfg = e.detail
    if (!cfg) return
    if (cfg.mode) miniBgMode.value = cfg.mode
    if (cfg.color) miniBgColor.value = cfg.color
    if (typeof cfg.alpha === 'number') miniBgAlpha.value = cfg.alpha
  })
})

const themeOptions = [
  { value: 'light', label: '海盐蓝', color: '#edf4fa' },
  { value: 'green', label: '薄荷清绿', color: '#edf7f2' },
  { value: 'orange', label: '奶油橘', color: '#fcf3eb' },
  { value: 'pink', label: '烟粉蔷薇', color: '#faf0f4' },
  { value: 'dark', label: '暗夜绿', color: '#1a2b24' },
  { value: 'blue', label: '深海蓝', color: '#172330' },
  { value: 'red', label: '极夜红', color: '#2a171a' },
  { value: 'purple', label: '暗玫紫', color: '#272036' },
  { value: 'c_light', label: '经典浅色', color: '#f5f7fa' },
  { value: 'c_dark', label: '经典深色', color: '#0d1117' },
  { value: 'c_blue', label: '经典藏青', color: '#0a1628' },
  { value: 'c_green', label: '经典青绿', color: '#f0f7f0' },
  { value: 'c_purple', label: '经典梦幻紫', color: '#f5f0ff' },
  { value: 'c_pink', label: '经典樱花粉', color: '#fff0f5' },
  { value: 'c_orange', label: '经典暖橘', color: '#fff8f0' },
  { value: 'c_red', label: '经典中国红', color: '#fff5f5' }
]

async function addFolder() {
  await musicStore.addFolder()
}

// 自动刷新曲库开关(状态以主进程持久化为准,重启后自动恢复)
const folderWatchOn = ref(false)
async function toggleFolderWatch() {
  const next = !folderWatchOn.value
  folderWatchOn.value = next
  window.electronAPI?.setFolderWatch(next)
}
try {
  window.electronAPI?.getFolderWatch().then(v => { folderWatchOn.value = !!v }).catch(() => {})
} catch {}

function removeFolder(folder) {
  musicStore.scanFolders = musicStore.scanFolders.filter(f => f !== folder)
  musicStore.saveToStorage()
}

async function addLyricFolder() {
  await musicStore.addLyricFolder()
}

function removeLyricFolder(folder) {
  musicStore.removeLyricFolder(folder)
}

// 在线歌词开关(localStorage,默认开启)
const onlineLyric = ref(localStorage.getItem('soundflow_online_lyric') !== '0')

function toggleOnlineLyric() {
  onlineLyric.value = !onlineLyric.value
  localStorage.setItem('soundflow_online_lyric', onlineLyric.value ? '1' : '0')
}

// 歌词来源:local(本地,不联网)/ netease / lrclib(默认)
const lyricSources = [
  { value: 'auto', label: '自动(推荐)' },
  { value: 'netease', label: '网易云' },
  { value: 'lrclib', label: 'LRCLIB' },
  { value: 'qq', label: 'QQ音乐' }
]
const lyricSource = ref((localStorage.getItem('soundflow_lyric_source') === 'local' ? 'auto' : (localStorage.getItem('soundflow_lyric_source') || 'auto')))

function setLyricSource(v) {
  lyricSource.value = v
  localStorage.setItem('soundflow_lyric_source', v)
  // 切换来源后立即重新获取当前歌曲歌词(缓存按来源隔离,会走新来源)
  const cur = playerStore.currentSong
  if (cur) {
    const hint = v === 'auto' ? '本地优先,无本地自动在线' : '在线优先,失败回退本地'
    playerStore.loadLyrics(cur)
    window.$toast?.('已切换到「' + v + '」(' + hint + ')', 'success')
  }
}

// 歌词翻译服务(MyMemory 免费 / DeepSeek 需 key)
const translateService = ref(localStorage.getItem('soundflow_translate_service') || 'mymemory')
const deepseekKey = ref(localStorage.getItem('soundflow_deepseek_key') || '')
const showDeepseekKey = ref(false)

function setTranslateService(v) {
  translateService.value = v
  localStorage.setItem('soundflow_translate_service', v)
}
function saveDeepseekKey() {
  localStorage.setItem('soundflow_deepseek_key', deepseekKey.value.trim())
}

// 快捷键自定义
const shortcutDefs = [
  { key: 'playPause', label: '播放 / 暂停' },
  { key: 'next', label: '下一曲' },
  { key: 'prev', label: '上一曲' },
  { key: 'volUp', label: '音量 +' },
  { key: 'volDown', label: '音量 -' },
  { key: 'mute', label: '静音' }
]
const shortcuts = ref(JSON.parse(localStorage.getItem('soundflow_shortcuts') || '{}'))
const recordingKey = ref('')

function startRecord(k) {
  recordingKey.value = k
}
function onRecordKey(e) {
  if (!recordingKey.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.code === 'Escape') { recordingKey.value = ''; return }
  const combo = (e.ctrlKey ? 'Control+' : '') + e.code
  shortcuts.value[recordingKey.value] = combo
  localStorage.setItem('soundflow_shortcuts', JSON.stringify(shortcuts.value))
  recordingKey.value = ''
}

// 恢复默认快捷键
function resetShortcuts() {
  const defaults = { playPause: 'Space', next: 'Control+ArrowRight', prev: 'Control+ArrowLeft', volUp: 'Control+ArrowUp', volDown: 'Control+ArrowDown', mute: 'Control+KeyM' }
  shortcuts.value = { ...defaults }
  localStorage.setItem('soundflow_shortcuts', JSON.stringify(defaults))
}

// 字体设置:系统字体 + 自定义导入
const systemFonts = [
  { label: '系统默认', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
  { label: '宋体', value: '"SimSun", serif' },
  { label: '黑体', value: '"SimHei", sans-serif' },
  { label: '楷体', value: '"KaiTi", serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", monospace' }
]
const currentFont = ref(localStorage.getItem('soundflow_font_family') || systemFonts[0].value)
const customFonts = ref(JSON.parse(localStorage.getItem('soundflow_custom_fonts') || '[]'))
const fontExpanded = ref(false) // 已导入字体区展开/收起
const songNotify = ref(localStorage.getItem('soundflow_song_notify') || 'card')
function setSongNotify(v) {
  songNotify.value = v
  localStorage.setItem('soundflow_song_notify', v)
  try { window.$toast?.('切歌通知已切换为「' + (v === 'off' ? '关闭' : v === 'card' ? '应用内卡片' : '系统横幅') + '」', 'success') } catch {}
}
function toggleAutoPlay() {
  appStore.autoPlay = !appStore.autoPlay
  localStorage.setItem('soundflow_auto_play', appStore.autoPlay ? '1' : '0')
}

function selectFont(family) {
  currentFont.value = family
  localStorage.setItem('soundflow_font_family', family)
  document.documentElement.style.setProperty('--font-family', family)
  // 按需注册:切换到的字体若尚未加载,异步加载 FontFace(避免启动时全部加载 90MB 卡顿)
  const name = (family || '').replace(/"/g, '')
  const cf = customFonts.value.find(f => f.name === name)
  if (cf) {
    try {
      const exists = [...document.fonts].some(ff => ff.family === name)
      if (!exists) {
        const f = new FontFace(cf.name, `url('${cf.url}')`)
        f.load().then(() => document.fonts.add(f)).catch(() => {})
      }
    } catch {}
  }
}

async function importFont() {
  if (!window.electronAPI) return
  const res = await window.electronAPI.selectFontFile()
  if (!res) return
  try {
    const f = new FontFace(res.name, `url('${res.url}')`)
    await f.load()
    document.fonts.add(f)
  } catch {}
  customFonts.value.push(res)
  localStorage.setItem('soundflow_custom_fonts', JSON.stringify(customFonts.value))
  selectFont(`"${res.name}"`)
}

async function importFontFolder() {
  if (!window.electronAPI) return
  const list = await window.electronAPI.selectFontFolder()
  if (!list || !list.length) { window.$toast?.('该文件夹中未找到字体文件(.ttf/.otf/.woff/.woff2)', 'warning'); return }
  let ok = 0
  for (const res of list) {
    if (customFonts.value.some(f => f.url === res.url)) continue
    try {
      const f = new FontFace(res.name, `url('${res.url}')`)
      await f.load()
      document.fonts.add(f)
      customFonts.value.push(res)
      ok++
    } catch {}
  }
  if (ok) {
    localStorage.setItem('soundflow_custom_fonts', JSON.stringify(customFonts.value))
    selectFont(`"${customFonts.value[customFonts.value.length - 1].name}"`)
    window.$toast?.(`已从文件夹导入 ${ok} 个字体(共 ${list.length} 个)`, 'success')
  } else {
    window.$toast?.('字体加载失败(文件损坏或已全部导入)', 'warning')
  }
}

function removeCustomFont(i) {
  const name = customFonts.value[i].name
  customFonts.value.splice(i, 1)
  localStorage.setItem('soundflow_custom_fonts', JSON.stringify(customFonts.value))
  if (currentFont.value.includes(name)) selectFont(systemFonts[0].value)
}

// 批量下载歌词到歌词文件夹(并发 + 实时进度 + 完成弹窗)
const batchLyric = ref({
  running: false, total: 0, done: 0, success: 0, skipped: 0, failed: 0,
  msg: '', showResult: false, elapsed: '', finishedAt: '', folder: ''
})

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m} 分 ${(s % 60).toString().padStart(2, '0')} 秒`
}

function openLyricFolder() {
  if (batchLyric.value.folder && window.electronAPI) {
    window.electronAPI.openFolder(batchLyric.value.folder)
  }
}

async function batchDownloadLyrics() {
  if (batchLyric.value.running || !window.electronAPI) return
  const songs = musicStore.songs
  if (songs.length === 0) { batchLyric.value.msg = '曲库为空,请先导入歌曲'; return }
  const folder = musicStore.lyricFolders[0]
  if (!folder) {
    batchLyric.value.msg = '请先在上方添加一个歌词文件夹,歌词将下载到那里'
    return
  }
  const startTime = Date.now()
  batchLyric.value = {
    running: true, total: songs.length, done: 0, success: 0, skipped: 0, failed: 0,
    saveFail: 0, matchFail: 0,
    msg: '正在下载…', showResult: false, elapsed: '', finishedAt: '', folder
  }

  const CONCURRENCY = 5 // 并发数,避免单首慢导致进度停滞
  const lyricFolders = [...musicStore.lyricFolders] // 展开为纯数组(Proxy 无法过 IPC 序列化)
  let idx = 0
  let doneCount = 0
  let success = 0, skipped = 0, failed = 0, saveFail = 0, matchFail = 0

  async function worker() {
    while (true) {
      const i = idx++
      if (i >= songs.length) break
      const s = songs[i]
      try {
        const hasLocal = await window.electronAPI.readLyricFile(s.path, lyricFolders)
        if (hasLocal) {
          skipped++
        } else {
          const res = await window.electronAPI.searchOnlineLyric({
            title: s.title, artist: s.artist || '', duration: s.duration || 0,
            source: lyricSource.value === 'local' ? 'auto' : lyricSource.value
          })
          if (res && res.lyrics) {
            const saved = await window.electronAPI.saveLyricToFolder(s.path, res.lyrics, folder)
            if (saved && saved.ok) success++
            else { saveFail++ }
          } else {
            matchFail++
          }
        }
      } catch { failed++ }
      doneCount++
      // 实时更新进度
      batchLyric.value.done = doneCount
      batchLyric.value.success = success
      batchLyric.value.skipped = skipped
      batchLyric.value.failed = failed
      batchLyric.value.saveFail = saveFail
      batchLyric.value.matchFail = matchFail
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, songs.length) }, () => worker()))
    const elapsedMs = Date.now() - startTime
    const now = new Date()
    batchLyric.value.elapsed = fmtElapsed(elapsedMs)
    batchLyric.value.finishedAt = now.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    batchLyric.value.msg = ''
    batchLyric.value.showResult = true
  } finally {
    batchLyric.value.running = false
  }
}
</script>

<style scoped>
.settings-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.view-header { display: flex; align-items: center; gap: 12px; padding: 20px 24px 12px; flex-shrink: 0; }
.back-btn { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-md); color: var(--text-secondary); }
.back-btn:hover { background: var(--bg-hover); }
.back-btn svg { width: 20px; height: 20px; }
.header-title { font-size: 24px; font-weight: 700; color: var(--text-primary); }

.settings-content { flex: 1; overflow-y: auto; padding: 0 24px 24px; }

.settings-section { margin-bottom: 24px; }
.section-title { font-size: var(--font-size-sm); font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }

/* 快捷键总览:键帽卡片 */
.shortcut-overview {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding: 10px 14px; margin-bottom: 8px;
  background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}
.sc-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.sc-item kbd {
  min-width: 34px; text-align: center;
  padding: 3px 8px;
  background: var(--bg-hover); border: 1px solid var(--border-color);
  border-bottom-width: 2px; border-radius: 5px;
  font-family: inherit; font-size: 11px; color: var(--text-primary);
}
.setting-item {
  display: flex; align-items: center; justify-content: space-between;  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}

.setting-label { flex: 1; }
.label-text { font-size: var(--font-size-base); color: var(--text-primary); font-weight: 500; }
.label-desc { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-left: 8px; }

.setting-control { display: flex; align-items: center; gap: 12px; }
.setting-control input[type="range"] { width: 120px; accent-color: var(--color-primary); }
.volume-val { font-size: var(--font-size-sm); color: var(--text-secondary); min-width: 36px; }

select {
  padding: 6px 12px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.theme-options { display: flex; gap: 8px; flex-wrap: wrap; }
.theme-btn {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 8px 12px;
  border: 2px solid var(--border-color);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}
.theme-btn:hover { border-color: var(--color-primary-light); }
.theme-btn.active { border-color: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-alpha); }
.theme-preview { width: 36px; height: 24px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); }
.theme-btn span { font-size: var(--font-size-xs); color: var(--text-secondary); }

.rate-options { display: flex; gap: 4px; }
.mini-bg-options { display: flex; gap: 4px; }
.color-input { width: 40px; height: 28px; padding: 0; border: 1px solid var(--border-color); border-radius: 6px; background: none; cursor: pointer; }
.rate-btn {
  padding: 4px 10px;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
.rate-btn:hover { border-color: var(--color-primary-light); }
.rate-btn.active { background: var(--color-primary); color: white; border-color: var(--color-primary); }

.setting-btn {
  padding: 6px 14px;
  background: var(--color-primary);
  color: white;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}
/* 次级按钮:有边框描边的按钮样式(用于主题导入导出/响度均衡/文件夹监控等开关) */
.sec-btn {
  padding: 6px 16px;
  background: var(--bg-card, rgba(255,255,255,0.08));
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all 0.15s;
}
.sec-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.sec-btn.on { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.sec-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.lyric-source-group { display: flex; gap: 6px; }
.source-btn {
  padding: 6px 14px;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  transition: all var(--transition-fast);
}
.source-btn:hover { color: var(--text-primary); }
.source-btn.active { background: var(--color-primary); border-color: var(--color-primary); color: white; }
.deepseek-key-input { width: 100%; margin-top: 8px; }
.deepseek-key-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; position: relative; }
.deepseek-key-row .deepseek-key-input { flex: 1; margin-top: 0; }
.key-eye { flex-shrink: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: var(--bg-hover); border: 1px solid var(--border-color); border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; }
.key-eye:hover { border-color: var(--color-primary); }
.key-configured { flex-shrink: 0; font-size: 11px; color: #42c988; font-weight: 500; }
.font-row { display: flex; align-items: center; gap: 10px; }
.font-select {
  flex: 1; padding: 7px 10px; font-size: var(--font-size-sm);
  background: var(--bg-card); color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: var(--radius-md);
}
.custom-font-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; }
.font-name { font-size: var(--font-size-sm); color: var(--text-primary); }
.font-remove { padding: 3px 10px; font-size: var(--font-size-xs); }
/* 字体文件夹字体选择网格 */
.font-pick-grid { display: flex; flex-wrap: wrap; gap: 8px; max-height: 180px; overflow-y: auto; padding: 4px 2px; }
.font-pick-card {
  padding: 8px 14px; font-size: 14px; color: var(--text-primary);
  background: var(--bg-card, rgba(255,255,255,0.06)); border: 1px solid var(--border-color);
  border-radius: 8px; cursor: pointer; transition: all 0.15s; max-width: 100%;
}
.font-pick-card:hover { border-color: var(--color-primary); }
.font-pick-card.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
/* 已导入字体展开区(可滑动) */
.font-collapse { display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 4px 0; }
.collapse-arrow { color: var(--text-secondary); font-size: var(--font-size-sm); transition: transform 0.2s; }
.font-expand-list { max-height: 200px; overflow-y: auto; border-top: 1px dashed var(--border-color); margin-top: 6px; padding: 2px 4px; }
.font-size-row { display: flex; align-items: center; gap: 10px; }
.font-size-row input[type="range"] { width: 180px; }

/* 音效 */
.eq-area { width: 100%; display: flex; flex-direction: column; gap: 14px; }
.eq-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.eq-preset-btn { font-size: var(--font-size-xs); padding: 4px 10px; }
.eq-sliders { display: flex; justify-content: space-between; gap: 4px; }
.eq-slider-col { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
.eq-slider-col input[type="range"] { width: 100%; writing-mode: vertical-lr; direction: rtl; height: 90px; }
.eq-gain { font-size: 10px; color: var(--text-tertiary); }
.eq-freq { font-size: 10px; color: var(--text-tertiary); }
.eq-extra { display: flex; gap: 20px; }
.eq-extra-item { display: flex; align-items: center; gap: 8px; }
.eq-extra-item span { min-width: 48px; }
.eq-extra-item input[type="range"] { width: 120px; }

.batch-progress-track { width: 100%; height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden; }
.batch-progress-fill { height: 100%; background: var(--color-primary); border-radius: 3px; transition: width 0.2s; }

.batch-done-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.batch-done-card {
  width: 360px; max-width: 90vw; padding: 24px;
  background: var(--bg-secondary); border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg); text-align: center;
}
.done-icon { font-size: 40px; margin-bottom: 8px; }
.batch-done-card h3 { font-size: 17px; color: var(--text-primary); margin-bottom: 14px; }
.done-row { font-size: var(--font-size-sm); color: var(--text-primary); line-height: 1.9; }
.done-row.muted { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.done-folder {
  margin: 10px 0 16px; padding: 8px 10px; border-radius: var(--radius-md);
  background: var(--bg-hover); font-size: var(--font-size-xs); color: var(--text-secondary);
  word-break: break-all; text-align: left;
}
.done-btns { display: flex; justify-content: center; gap: 10px; }
.done-close { padding: 6px 16px; border: 1px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-secondary); font-size: var(--font-size-sm); }
.done-close:hover { background: var(--bg-hover); color: var(--text-primary); }

.folder-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin-bottom: 4px;
}
.folder-path { flex: 1; font-size: var(--font-size-sm); color: var(--text-secondary); font-family: 'Cascadia Code', 'Consolas', monospace; }
.remove-btn { font-size: var(--font-size-xs); color: var(--color-danger); padding: 4px 8px; border-radius: var(--radius-sm); }
.remove-btn:hover { background: rgba(255,77,79,0.1); }

.about-card {
  display: flex; align-items: center; gap: 16px;
  padding: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
}
.about-logo svg { width: 48px; height: 48px; }
.about-info h4 { font-size: var(--font-size-lg); color: var(--text-primary); font-weight: 600; }
.about-info span { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.about-info p { font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: 4px; }
.settings-search { display: flex; align-items: center; gap: 8px; padding: 10px 24px 4px; flex-shrink: 0; }
.settings-search svg { width: 16px; height: 16px; color: var(--text-tertiary); margin-left: 8px; }
.settings-search input { flex: 1; max-width: 340px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 7px 28px 7px 30px; color: var(--text-primary); font-size: var(--font-size-base); outline: none; }
.settings-search input:focus { border-color: var(--color-primary); }
.search-clear { background: none; border: none; color: var(--text-tertiary); cursor: pointer; margin-left: -26px; font-size: 13px; }
.search-clear:hover { color: var(--text-primary); }
/* 歌词管理弹窗(复用 save-queue 弹窗类需自带定义) */
.lyric-mgr-card { width: 460px; max-width: 90vw; max-height: 72vh; display: flex; flex-direction: column; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; color: var(--text-primary); padding: 18px; }
.lyric-mgr-card h3 { margin: 0 0 10px; font-size: 16px; }
.lyric-mgr-stats { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.lyric-mgr-list { flex: 1; overflow-y: auto; margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
.lyric-mgr-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; }
.lyric-mgr-row:hover { background: var(--bg-hover); }
.lyric-mgr-info { flex: 1; min-width: 0; }
.lyric-mgr-title { font-size: 13px; color: var(--text-primary); }
.lyric-mgr-artist { font-size: 11px; color: var(--text-secondary); }
.lyric-mgr-status { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(255,143,143,0.15); color: #ff8f8f; flex-shrink: 0; }
.lyric-mgr-status.ok { background: rgba(80,220,140,0.15); color: #50dc8c; }
.lyric-mgr-del { background: none; border: none; cursor: pointer; font-size: 13px; opacity: 0.6; }
.lyric-mgr-del:hover { opacity: 1; }
</style>
