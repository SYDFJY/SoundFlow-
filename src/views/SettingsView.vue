<template>
  <div class="settings-view">
    <div class="view-header">
      <button class="back-btn" @click="$router.back()" title="返回" aria-label="返回">
        <Icon name="back" :size="16" />
      </button>
      <h1 class="header-title">设置</h1>
    </div>

    <div class="settings-search">
      <Icon name="search" :size="15" />
      <input v-model="searchQuery" placeholder="搜索设置项…(如 歌词 / 字体 / 开机自启)" />
      <button v-if="searchQuery" class="search-clear" title="清除搜索" aria-label="清除搜索" @click="searchQuery = ''"><Icon name="close" :size="14" /></button>
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
          <button class="switch" role="switch" :aria-checked="appStore.autoPlay" aria-label="启动自动续播" :class="{ on: appStore.autoPlay }" @click="toggleAutoPlay">
            <span class="switch-track"></span>
          </button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">跟随系统深色模式</span>
            <span class="label-desc">系统切换深色/浅色时自动切换主题(手动选主题将关闭此功能)</span>
          </div>
          <button class="switch" role="switch" :aria-checked="appStore.followSystemTheme" aria-label="跟随系统深色模式" :class="{ on: appStore.followSystemTheme }" @click="appStore.setFollowSystemTheme(!appStore.followSystemTheme)">
            <span class="switch-track"></span>
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
        <!-- 输出设备:走 AudioContext.setSinkId(Chromium 原生能力),不是 WASAPI 独占 -->
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">输出设备</span>
            <span class="label-desc">
              <template v-if="playerStore.outputDeviceError">{{ playerStore.outputDeviceError }}</template>
              <template v-else-if="!playerStore.outputDevices.length">未检测到可选设备(使用系统默认输出)</template>
              <template v-else>切换音频输出设备;插拔耳机后列表会自动刷新</template>
            </span>
          </div>
          <select v-if="playerStore.outputDevices.length" :value="playerStore.outputDeviceId" @change="changeOutputDevice($event.target.value)" aria-label="输出设备">
            <option value="default">系统默认</option>
            <option v-for="d in playerStore.outputDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || '未命名设备' }}</option>
          </select>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">切歌时自动定位当前播放</span>
            <span class="label-desc">长列表里自动滚动到正在播放的那一行(默认开)</span>
          </div>
          <button class="switch" role="switch" :aria-checked="autoLocate" aria-label="切歌时自动定位当前播放" :class="{ on: autoLocate }" @click="toggleAutoLocate">
            <span class="switch-track"></span>
          </button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">响度均衡</span>
            <span class="label-desc">ReplayGain — 换歌音量均衡(开启后后台分析,可能占用少量 CPU)</span>
          </div>
          <button class="switch" role="switch" :aria-checked="playerStore.replayGainEnabled" aria-label="响度均衡" :class="{ on: playerStore.replayGainEnabled }" @click="toggleReplayGain">
            <span class="switch-track"></span>
          </button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">切歌续播</span>
            <span class="label-desc">记忆上次播放进度(默认关 = 切歌从头播放;开启后切回未播完的歌会从上次进度继续)</span>
          </div>
          <button class="switch" role="switch" :aria-checked="playerStore.resumeProgress" aria-label="切歌续播" :class="{ on: playerStore.resumeProgress }" @click="playerStore.resumeProgress = !playerStore.resumeProgress; playerStore.saveSettings()">
            <span class="switch-track"></span>
          </button>
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
      </div>

      <!-- 扫描设置 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.library') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">扫描目录</span>
            <span class="label-desc">{{ musicStore.scanFolders.length }} 个目录（单个目录的重新扫描与移除在「音乐目录」页）</span>
          </div>
          <div class="setting-control" style="display: flex; gap: 6px;">
            <button class="btn" @click="addFolder">添加目录</button>
            <button class="btn" @click="$router.push('/folder')">管理目录</button>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">自动刷新曲库</span>
            <span class="label-desc">监听扫描目录,新增/删除文件自动同步(事件驱动,无后台轮询)</span>
          </div>
          <button class="switch" role="switch" :aria-checked="folderWatchOn" aria-label="自动刷新曲库" :class="{ on: folderWatchOn }" @click="toggleFolderWatch">
            <span class="switch-track"></span>
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
          <button class="switch" role="switch" :aria-checked="onlineLyric" aria-label="在线歌词" :class="{ on: onlineLyric }" @click="toggleOnlineLyric">
            <span class="switch-track"></span>
          </button>
        </div>
        <div class="setting-item" v-if="onlineLyric">
          <div class="setting-label">
            <span class="label-text">歌词来源</span>
            <span class="label-desc">LRCLIB 免费开放；QQ 音乐中文覆盖广；网易云中文较全；自动 = LRCLIB 优先，失败再 QQ 音乐 → 网易云</span>
          </div>
          <div class="lyric-source-group">
            <button v-for="opt in lyricSources" :key="opt.value" class="chip" :class="{ active: playerStore.lyricSource === opt.value }" @click="playerStore.changeLyricSource(opt.value)">{{ opt.label }}</button>
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
            <button class="key-eye" :aria-label="showDeepseekKey ? '隐藏密钥' : '显示密钥'" @click="showDeepseekKey = !showDeepseekKey" :title="showDeepseekKey ? '隐藏' : '显示'"><Icon :name="showDeepseekKey ? 'darkMode' : 'lightMode'" :size="14" /></button>
            <span v-if="deepseekKey" class="key-configured">已配置<Icon name="check" :size="12" /></span>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">翻译缓存</span>
            <span class="label-desc">译文按原文逐行校验，歌词换过之后旧译文会自动作废；这里只是手动兜底</span>
          </div>
          <button class="btn" @click="clearTransCache">清除翻译缓存</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">在线歌词缓存</span>
            <span class="label-desc">自动记住取回来的在线歌词，换来源或发现某首歌歌词不对时可清掉重取</span>
          </div>
          <button class="btn" @click="clearOnlineLyricCache">清除在线歌词缓存</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">歌词文件夹</span>
            <span class="label-desc">独立存放 .lrc 文件，按文件名自动匹配歌曲（列表与移除去「音乐目录」页）</span>
          </div>
          <div class="setting-control" style="display: flex; gap: 6px;">
            <button class="btn" @click="addLyricFolder">添加文件夹</button>
            <button class="btn" @click="$router.push('/folder')">管理目录</button>
          </div>
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
                <div class="done-icon"><Icon name="check" :size="46" /></div>
                <h3>歌词下载完成</h3>
                <div class="done-row">成功下载 <b>{{ batchLyric.success }}</b> 首 &nbsp;·&nbsp; 已有 <b>{{ batchLyric.skipped }}</b> 首</div>
                <div class="done-row" v-if="batchLyric.matchFail || batchLyric.saveFail || batchLyric.failed">未匹配 <b>{{ batchLyric.matchFail }}</b> 首 · 写入失败 <b>{{ batchLyric.saveFail }}</b> 首 · 其他失败 <b>{{ batchLyric.failed }}</b> 首</div>
                <!-- 未匹配的原因分开写:超时重试往往就能成,而"确实没有"不必再试 -->
                <div class="done-row muted" v-if="batchLyric.matchFail">
                  <template v-if="batchLyric.whyTimeout">获取超时 {{ batchLyric.whyTimeout }} · </template>
                  <template v-if="batchLyric.whyNetwork">网络不可用 {{ batchLyric.whyNetwork }} · </template>
                  <template v-if="batchLyric.whySource">音源返回异常 {{ batchLyric.whySource }} · </template>
                  <template v-if="batchLyric.whyNone">确实没有这首歌 {{ batchLyric.whyNone }}</template>
                </div>
                <div class="done-row muted">用时 {{ batchLyric.elapsed }} · 完成时间 {{ batchLyric.finishedAt }}</div>
                <div class="done-folder" :title="batchLyric.folder">下载到：{{ batchLyric.folder }}</div>
                <div class="done-btns">
                  <button
                    v-if="batchLyric.whyTimeout || batchLyric.whyNetwork || batchLyric.whySource"
                    class="btn"
                    :disabled="batchLyric.running"
                    @click="retryUnmatchedLyrics"
                  ><Icon name="refresh" :size="15" />重试未匹配的 {{ (batchLyric.unmatched || []).length }} 首</button>
                  <button class="btn" @click="openLyricFolder"><Icon name="opendir" :size="15" />打开歌词文件夹</button>
                  <button class="btn--ghost btn--sm" @click="batchLyric.showResult = false">关闭</button>
                </div>
              </div>
            </div>
          </transition>
        </teleport>
      </div>

      <!-- 音效 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.eq') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">均衡器 / 音效</span>
            <span class="label-desc">10 段 EQ + 预设 + 重低音 + 空间声场；完整调节（含频响曲线与自定义预设）在播放栏的音效面板里</span>
          </div>
          <button class="switch" role="switch" :aria-checked="playerStore.eqSettings.enabled" aria-label="均衡器 / 音效" :class="{ on: playerStore.eqSettings.enabled }" @click="playerStore.setEqEnabled(!playerStore.eqSettings.enabled)">
            <span class="switch-track"></span>
          </button>
        </div>
      </div>

      <!-- 字体 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.font') }}</h3>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">自定义主色</span>
            <span class="label-desc">实时全局生效(按钮/高亮/进度条),点「恢复」还原主题默认色</span>
          </div>
          <div class="setting-control mini-color-picker">
            <div class="mini-swatches">
              <button v-for="c in PRIMARY_SWATCHES" :key="c" class="mini-swatch" :class="{ active: (appStore.customPrimary || '').toLowerCase() === c.toLowerCase() }" :style="{ background: c }" :title="c" @click="setPrimary(c)"></button>
            </div>
            <div ref="primaryPickrEl" class="pickr-wrap"></div>
            <button class="btn" @click="resetPrimary">恢复默认</button>
          </div>
        </div>
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
            <input type="range" min="10" max="20" step="1" :value="appStore.fontSize" @input="appStore.setFontSize(parseInt($event.target.value))" />
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
        <div class="setting-item" v-if="customFonts.length">
          <div class="setting-label"><span class="label-text">字体文件占用</span></div>
          <div class="font-tidy-row">
            <button class="btn" :disabled="fontTidy.busy" @click="tidyFonts">
              {{ fontTidy.busy ? '整理中…' : '整理字体文件' }}
            </button>
            <span class="setting-hint">
              指认字体原件所在的文件夹:把复制进数据目录的同名副本删掉、改为直接引用原件。
              字体不会丢;若之后移动/改名那个文件夹,字体才会失效。
            </span>
          </div>
        </div>
      </div>

      <!-- 快捷键 -->
      <div class="settings-section">
        <h3 class="section-title">{{ t('settings.shortcuts') }}</h3>
        <div class="shortcut-overview">
          <div v-for="d in shortcutDefs" :key="d.key" class="sc-item">
            <kbd>{{ pretty(shortcuts[d.key]) }}</kbd>
            <span class="sc-label">{{ d.label }}</span>
          </div>
        </div>
        <!-- 作用范围必须写清楚:默认快捷键只在应用聚焦时生效,录制的组合才会注册到系统级 ——
             不说明的话,用户在其它程序里按 Ctrl+→ 没反应,只会觉得"快捷键坏了" -->
        <div class="shortcut-scope-hint">
          这些快捷键<strong>在应用内始终可用</strong>;带 Ctrl / Alt / Shift 的组合还会注册为
          <strong>系统级</strong>快捷键(应用在后台也能切歌)。单个按键(如空格)不做系统级注册 ——
          否则会把那个按键从其它程序手里抢走。
        </div>
        <div class="setting-item" v-for="d in shortcutDefs" :key="d.key">
          <div class="setting-label">
            <span class="label-text">{{ d.label }}</span>
          </div>
          <button class="btn" :class="{ recording: recordingKey === d.key }" @click="startRecord(d.key)" @keydown="onRecordKey">
            {{ recordingKey === d.key ? '按新快捷键…' : pretty(shortcuts[d.key]) }}
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
          <button class="switch" role="switch" :aria-checked="loginItem" aria-label="开机自启" :class="{ on: loginItem }" @click="toggleLoginItem">
            <span class="switch-track"></span>
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
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">硬件加速(GPU 渲染)</span>
            <span class="label-desc">界面更流畅清晰;若花屏/白屏请关闭。重启生效</span>
          </div>
          <button class="switch" role="switch" :aria-checked="hardwareAccel" aria-label="硬件加速" :class="{ on: hardwareAccel }" @click="toggleHardwareAccel">
            <span class="switch-track"></span>
          </button>
        </div>
      </div>

      <!-- 数据安全 -->
      <div class="settings-section">
        <h3 class="section-title"><Icon name="warning" :size="15" />数据安全</h3>
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
          <button class="sec-btn" :class="{ 'is-loading': checkingUpdate }" :disabled="checkingUpdate" @click="checkUpdate">{{ checkingUpdate ? '检查中…' : updateMsg || '检查更新' }}</button>
        </div>
        <div class="about-card">
          <div class="about-logo">
            <img src="/icon.png" alt="logo" style="width:48px;height:48px;border-radius:12px;object-fit:cover;" />
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
          <button class="btn" :class="{ 'is-loading': cacheBusy }" @click="clearCache" :disabled="cacheBusy">{{ cacheBusy ? '清理中…' : '清理封面缓存' }}</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">元数据解析缓存</span>
            <span class="label-desc">{{ storageInfo.mdCacheCount || 0 }} 首的解析结果（重新扫描同一目录时直接复用，命中率会写进日志；清理后下次扫描重新解析）</span>
          </div>
          <button class="btn" :class="{ 'is-loading': mdCacheBusy }" @click="clearMdCache" :disabled="mdCacheBusy">{{ mdCacheBusy ? '清理中…' : '清理解析缓存' }}</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">转码缓存</span>
            <span class="label-desc">APE/WMA/AIFF/ALAC 等非原生格式转出的 FLAC：{{ storageInfo.transcodeCount || 0 }} 个 · {{ storageInfo.transcodeSize ? (storageInfo.transcodeSize / 1048576).toFixed(1) : '0.0' }} MB（清理后下次播放会重新转码）</span>
          </div>
          <button class="btn" :class="{ 'is-loading': transcodeBusy }" @click="clearTranscode" :disabled="transcodeBusy">{{ transcodeBusy ? '清理中…' : '清理转码缓存' }}</button>
        </div>
        <div class="setting-item">
          <div class="setting-label">
            <span class="label-text">本地歌词管理</span>
            <span class="label-desc">查看歌曲本地歌词状态,删除不需要的歌词文件</span>
          </div>
          <button class="btn" @click="openLyricManager">打开管理</button>
        </div>
      </div>

      <!-- 诊断:把只存在于日志里的运行时状态摆出来(工具链/缓存/切歌耗时/音频链/失败清单)
           —— 用户报"卡/慢/怪"时能自查,定位时也不用再靠猜 -->
      <section class="settings-section">
        <h2 class="section-title">诊断</h2>
        <p class="section-desc">运行时状态一览。这些数字平时只在日志里,放在这里便于自查与反馈问题。</p>
        <DiagnosticsPanel />
      </section>
    </div>
  </div>

  <!-- 本地歌词管理弹窗 -->
  <div v-if="lyricMgrOpen" class="save-queue-mask" @click.self="lyricMgrOpen = false">
    <div class="modal-card save-queue-card lyric-mgr-card">
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
          <span class="lyric-mgr-status" :class="{ ok: lyricStatus[s.path] }"><Icon :name="lyricStatus[s.path] ? 'check' : 'close'" :size="12" />{{ lyricStatus[s.path] ? '有' : '无' }}</span>
          <button v-if="lyricStatus[s.path]" class="lyric-mgr-del" title="删除本地歌词" aria-label="删除本地歌词" @click="deleteMgrLyric(s)"><Icon name="remove" :size="12" /></button>
        </div>
        <div v-if="!filteredSongs.length" class="rank-empty">无匹配歌曲</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/appStore'
import { t, i18n, setLang } from '@/i18n'
import { useMusicStore } from '@/stores/musicStore'
import { usePlayerStore } from '@/stores/playerStore'
import { THEME_LIST as themeOptions } from '@/config/themeList'
import Icon from '@/components/icons/Icon.vue'
import DiagnosticsPanel from '@/components/DiagnosticsPanel.vue'
import { confirmDialog } from '@/composables/useConfirm'
import { noteFailure } from '@/utils/failures'
import { looksLikeLyrics } from '@/utils/lrc'
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, comboFromEvent, prettyCombo, loadShortcuts } from '@/utils/shortcut'

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
// 主题导入/导出:落盘与提示都在 appStore 里(顶栏主题下拉有同一对按钮,两处共用一份实现)
const exportTheme = () => appStore.exportThemeToFile()
const importTheme = () => appStore.importThemeFromFile()
const loginItem = ref(false)
async function loadLoginItem() {
  try { if (window.electronAPI && window.electronAPI.getLoginItem) loginItem.value = await window.electronAPI.getLoginItem() } catch {}
}

async function toggleLoginItem() {
  const v = !loginItem.value
  loginItem.value = v
  try { if (window.electronAPI && window.electronAPI.setLoginItem) await window.electronAPI.setLoginItem(v) } catch {}
  window.$toast?.(v ? '已开启开机自启' : '已关闭开机自启', 'success')
}
loadLoginItem()

// 硬件加速(GPU 渲染):默认关(软件渲染稳定),用户自测开启,重启生效
const hardwareAccel = ref(false)
async function loadHardwareAccel() {
  try { if (window.electronAPI && window.electronAPI.getHardwareAccel) hardwareAccel.value = await window.electronAPI.getHardwareAccel() } catch {}
}
async function toggleHardwareAccel() {
  const v = !hardwareAccel.value
  hardwareAccel.value = v
  try { if (window.electronAPI && window.electronAPI.setHardwareAccel) await window.electronAPI.setHardwareAccel(v) } catch {}
  window.$toast?.(v ? '已开启硬件加速,重启应用生效' : '已关闭硬件加速,重启应用生效', 'success', 3200)
}
loadHardwareAccel()
const searchQuery = ref('')
// 设置项搜索。
// 原实现对每个设置项交替「读 textContent → 写 style.display」:写之后再读会强制同步回流,
// 12 个分区约 60 个条目、每敲一键跑一遍,是设置页搜索卡顿的来源。
// 这里:① 先一次性读完所有文本 ② 再只做写入 ③ 加去抖,并改用 class 而非内联 style
// (内联 display 会被 Vue 的重新渲染绕开,新出现的条目不会继承过滤状态)。
let _searchTimer = null
let _pendingQuery = ''
function applySearch(q) {
  const qq = (q || '').trim().toLowerCase()
  const sections = [...document.querySelectorAll('.settings-section')]
  const content = document.querySelector('.settings-content')
  const secs = []
  const pairs = []
  for (const sec of sections) {
    secs.push({ sec, any: false })
    for (const item of sec.querySelectorAll('.setting-item')) pairs.push([item, secs.length - 1])
  }
  // 读阶段
  const texts = pairs.map(([item]) => (item.textContent || '').toLowerCase())
  // 写阶段(与读完全分离,不再触发逐项回流)
  for (let i = 0; i < pairs.length; i++) {
    const hit = !qq || texts[i].includes(qq)
    pairs[i][0].classList.toggle('search-hit', hit)
    if (hit) secs[pairs[i][1]].any = true
  }
  for (const s of secs) s.sec.classList.toggle('search-any', s.any)
  // 容器标记:配合 :not(.search-hit) 规则,让「过滤期间才被 v-if 渲染出来」的条目默认隐藏,
  // 而不是因为它没有内联状态就漏出来(旧实现写内联 style,无法覆盖这种情况)
  if (content) content.classList.toggle('searching', !!qq)
}
function scheduleSearch(q) {
  _pendingQuery = q
  if (_searchTimer) clearTimeout(_searchTimer)
  _searchTimer = setTimeout(() => { _searchTimer = null; applySearch(_pendingQuery) }, 120)
}
watch(searchQuery, scheduleSearch)
// 语言切换会改变条目文本,重新套用当前查询(否则按旧语言匹配的结果会残留)
watch(() => i18n.lang, () => { if (searchQuery.value) applySearch(searchQuery.value) })
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
const storageInfo = ref({ coversCount: 0, coversSize: 0, mdCacheCount: 0, transcodeCount: 0, transcodeSize: 0 })
const mdCacheBusy = ref(false)
const cacheBusy = ref(false)
async function loadStorageInfo() {
  try {
    if (window.electronAPI?.getStorageInfo) storageInfo.value = await window.electronAPI.getStorageInfo()
  } catch {}
}
loadStorageInfo()
// 清理元数据解析缓存:只影响扫描速度,不动曲库数据(下次扫描会重新解析并重建)
async function clearMdCache() {
  if (mdCacheBusy.value) return
  mdCacheBusy.value = true
  try {
    const r = await window.electronAPI?.clearMetadataCache?.()
    try { window.$toast?.(`已清理 ${r?.removed || 0} 首的解析缓存`, 'success') } catch {}
  } catch {
    try { window.$toast?.('清理失败', 'error') } catch {}
  }
  mdCacheBusy.value = false
  loadStorageInfo()
}

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

// 清理转码缓存:非原生格式(APE/WMA/AIFF/ALAC)转出的 FLAC,清掉下次播放会重新转。
// 原先只有诊断面板里有这个按钮 —— 同一页两套清缓存入口,已合并到这里。
const transcodeBusy = ref(false)
async function clearTranscode() {
  if (transcodeBusy.value) return
  transcodeBusy.value = true
  try {
    const r = await window.electronAPI?.clearTranscodeCache?.()
    try { window.$toast?.(`已清理 ${r?.removed || 0} 个转码缓存文件`, 'success') } catch {}
  } catch {
    try { window.$toast?.('清理失败', 'error') } catch {}
  }
  transcodeBusy.value = false
  loadStorageInfo()
}

// 本地歌词管理
const lyricMgrOpen = ref(false)
const lyricMgrSearch = ref('')
const lyricStatus = ref({})
const lyricMgrBusy = ref(false)

// Esc 关闭弹窗
function onSettingsEsc() { lyricMgrOpen.value = false }
// 迷你窗背景同步(命名函数便于卸载时移除,避免监听泄漏)
// 自定义主色(全局联动)
const PRIMARY_SWATCHES = ['#1677E6', '#4493f8', '#722ed1', '#13c2c2', '#52c41a', '#fa8c16', '#f5222d', '#eb2f96', '#f2f0ea', '#1e2433']
const primaryPickrEl = ref(null)
let _primaryPickr = null
function setPrimary(c) { appStore.setPrimaryColor(c) }
function resetPrimary() { appStore.resetPrimaryColor() }
function initPrimaryPickr() {
  if (!primaryPickrEl.value || typeof window.Pickr === 'undefined') return
  _primaryPickr = window.Pickr.create({
    el: primaryPickrEl.value,
    theme: 'nano',
    default: appStore.customPrimary || '#1677E6',
    swatches: PRIMARY_SWATCHES,
    components: { preview: true, opacity: false, hue: true, interaction: { hex: true, input: true, save: true } }
  })
  _primaryPickr.on('save', (color) => { if (color) appStore.setPrimaryColor(color.toHEXA().toString()) })
  _primaryPickr.on('change', (color) => { if (color) appStore.setPrimaryColor(color.toHEXA().toString()) })
}

onMounted(() => document.addEventListener('soundflow:esc', onSettingsEsc))
onMounted(() => playerStore.initOutputDevices()) // 设备列表 + devicechange 监听
onUnmounted(() => {
  document.removeEventListener('soundflow:esc', onSettingsEsc)
  if (_searchTimer) { clearTimeout(_searchTimer); _searchTimer = null }
})
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
// 输出设备:切换失败时 playerStore 会把原因写进 outputDeviceError,界面直接显示(不静默)
async function changeOutputDevice (id) {
  const ok = await playerStore.setOutputDevice(id)
  if (ok) window.$toast?.('已切换输出设备', 'success')
  else window.$toast?.(playerStore.outputDeviceError || '切换输出设备失败', 'warning')
}

// 切歌自动定位(列表侧每次切歌现读这个键,所以改完即刻生效)
const autoLocate = ref(localStorage.getItem('soundflow_autolocate') !== '0')
function toggleAutoLocate () {
  autoLocate.value = !autoLocate.value
  try { localStorage.setItem('soundflow_autolocate', autoLocate.value ? '1' : '0') } catch (_) {}
}

async function openLyricManager() {
  lyricMgrOpen.value = true
  if (!musicStore.lyricFolders || !musicStore.lyricFolders.length) {
    try { window.$toast?.('未配置歌词文件夹,将仅检查歌曲同目录 .lrc(可在设置-歌词添加歌词文件夹)', 'info', 3600) } catch {}
  }
  await scanLyricStatusAll()
}
async function deleteMgrLyric(s) {
  if (!window.electronAPI?.deleteLyricFile) return
  try {
    const r = await window.electronAPI.deleteLyricFile(s.path, [...musicStore.lyricFolders])
    // 主进程失败时返回 { ok:false, error },**不抛异常** —— 此前忽略返回值,
    // 于是删除失败也会提示"已删除"、并把状态标成"无"(界面开始说谎)。
    // 播放页那处一直是检查返回值的,两处行为现在对齐。
    if (!r || r.ok === false) {
      noteFailure('lyric.delete', '删除本地歌词失败', (r && r.error) || '未知原因')
      window.$toast?.('删除失败:' + ((r && r.error) || '未知原因'), 'error')
      return
    }
    lyricStatus.value[s.path] = false
    window.$toast?.('已把「' + s.title + '」的本地歌词移入回收站(可还原)', 'success')
  } catch (e) {
    noteFailure('lyric.delete', '删除本地歌词异常', e)
    window.$toast?.('删除失败', 'error')
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
// 标签备份管理(写回前自动备份,可回滚)
const tagBackups = ref([])
async function loadTagBackups() {
  try { tagBackups.value = (await window.electronAPI.listTagBackups()) || [] } catch { tagBackups.value = [] }
}
async function restoreTag(b) {
  if (!(await confirmDialog({ message: `还原「${b.name}」到修改标签前的版本？`, detail: '当前文件将被备份副本覆盖(仅恢复该文件)', confirmText: '还原' }))) return
  const r = await window.electronAPI.restoreTagBackup(b.id)
  if (r && r.ok) { window.$toast?.('已还原原文件', 'success'); loadTagBackups() }
  else { window.$toast?.(r?.error || '还原失败', 'error') }
}
async function clearTagBackups() {
  if (!(await confirmDialog({ message: '确定清空全部标签备份？', detail: '清空后无法再还原到旧标签', confirmText: '清空', danger: true }))) return
  const r = await window.electronAPI.clearTagBackups()
  if (r && r.ok) { window.$toast?.('已清空', 'success'); tagBackups.value = [] }
  else { window.$toast?.(r?.error || '清空失败', 'error') }
}

// 主色取色器(自定义主色,全局联动)
onMounted(() => {
  loadTagBackups()
  initPrimaryPickr()
})

// 主题清单已收敛到 @/config/themeList(此前与 TopBar 各存一份重复列表)

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

// 目录的列表与移除都在「音乐目录」页(那边移除前有确认框,还能单独重扫某个目录)
async function addLyricFolder() {
  await musicStore.addLyricFolder()
}

// 在线歌词开关(localStorage,默认开启)
const onlineLyric = ref(localStorage.getItem('soundflow_online_lyric') !== '0')

function toggleOnlineLyric() {
  onlineLyric.value = !onlineLyric.value
  localStorage.setItem('soundflow_online_lyric', onlineLyric.value ? '1' : '0')
}

// 歌词来源:auto(本地优先,无本地自动在线)/ netease / lrclib / qq
// 清单、当前值与"切换+重载+提示"全在 store 里(播放页歌词工具栏有同一个入口,
// 两处共用一份实现 —— 界面各自记一份 ref 就会出现"这边切了那边还显示旧的")
const lyricSources = playerStore.LYRIC_SOURCE_OPTIONS

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

// 清除译文缓存:正常使用中它靠"原文签名"自净(歌词变了旧译文就作废),这个入口是给
// "想立刻重来一遍"或用过旧版本、想清掉历史坏数据的人
async function clearTransCache() {
  if (!(await confirmDialog({ message: '清除翻译缓存?', detail: '只删译文,不动歌词与曲库;下次显示翻译会重新请求', confirmText: '清除' }))) return
  try {
    playerStore.clearTranslationCache()
    window.$toast?.('翻译缓存已清除', 'success')
  } catch (e) {
    window.$toast?.('清除失败:' + (e && e.message), 'error')
  }
}

// 只重试上一轮"未匹配"的那些:超时/网络抖动是主因,原样再跑一遍通常就成;
// 真正的"确实没有"那批也会再查一次,代价可接受(用户自己点的)
async function retryUnmatchedLyrics() {
  const list = Array.isArray(batchLyric.value.unmatched) ? batchLyric.value.unmatched.slice() : []
  if (!list.length) return
  batchLyric.value.showResult = false
  await batchDownloadLyrics(list)
}

// 清除在线歌词缓存:歌词缓存此前**没有任何清理入口**(只有翻译/封面/解析/转码有)—— 一旦某首歌
// 存进了错的歌词(音源匹配错、错误页),它会一直命中,用户没有任何办法自救
async function clearOnlineLyricCache() {
  if (!(await confirmDialog({ message: '清除在线歌词缓存?', detail: '只删缓存的在线歌词,不动本地 .lrc 与曲库;下次播放会重新联网获取', confirmText: '清除' }))) return
  try {
    const n = await playerStore.clearOnlineLyricCache()
    window.$toast?.(n ? `已清除 ${n} 条在线歌词缓存` : '在线歌词缓存本来就是空的', 'success')
  } catch (e) {
    window.$toast?.('清除失败:' + (e && e.message), 'error')
  }
}

// 快捷键自定义(动作清单与默认值都来自 @/utils/shortcut,避免界面与匹配逻辑各写一份)
const shortcutDefs = SHORTCUT_ACTIONS
const shortcuts = ref(loadShortcuts())
const recordingKey = ref('')
/** 组合串给人看:Control+ArrowRight → Ctrl+→ */
const pretty = (v) => (v ? prettyCombo(v) : '未设置')

function startRecord(k) {
  recordingKey.value = k
}
function onRecordKey(e) {
  if (!recordingKey.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.code === 'Escape') { recordingKey.value = ''; return }
  // 与匹配端共用 comboFromEvent:此前这里只拼 ctrlKey,录 "Alt+X" 会存成 "X" ——
  // 于是按单键就触发,而且这个裸键还会被注册成系统级热键,把 X 从所有其它程序手里抢走
  const combo = comboFromEvent(e)
  // 同一个组合被两个动作占用:直接拒绝并说明,而不是让后录的悄悄覆盖前者
  const clash = SHORTCUT_ACTIONS.find((a) => a.key !== recordingKey.value && shortcuts.value[a.key] === combo)
  if (clash) {
    window.$toast?.(`${prettyCombo(combo)} 已经用在「${clash.label}」上了`, 'warning', 5000)
    return
  }
  shortcuts.value[recordingKey.value] = combo
  localStorage.setItem('soundflow_shortcuts', JSON.stringify(shortcuts.value))
  applyShortcuts(true) // 刚录完:裸键要顺带说明"只在应用内生效"
  recordingKey.value = ''
}

// 把快捷键交给主进程注册,并把失败原因说清楚 ——
// 此前注册失败只有主进程日志里一行 warn,用户看到的是"设了但按了没反应"
async function applyShortcuts(showScopeNote = false) {
  try {
    // 必须传**纯对象**:shortcuts.value 是 Vue 的响应式代理,Electron 的结构化克隆复制不了
    // Proxy,会直接抛 "An object could not be cloned" —— 表现为"录完快捷键弹注册失败",
    // 而主进程根本没收到,新快捷键要等下次启动才注册生效。
    const map = JSON.parse(JSON.stringify(shortcuts.value))
    const res = await window.electronAPI?.updateShortcuts(map)
    const failed = (res && res.failed) || []
    if (!failed.length) return
    const names = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.key, a.label]))
    // 裸键是**设计如此**(不做系统级注册,否则会把那个按键从所有程序手里抢走),不算失败:
    // 只在用户刚录完时说一句,启动/恢复默认时不打扰(默认里的空格就是裸键)
    const bare = failed.filter(f => f.reason === 'needs-modifier')
    const hard = failed.filter(f => f.reason !== 'needs-modifier')
    if (bare.length && showScopeNote) {
      const desc = bare.map(f => `${names[f.action] || f.action}(${prettyCombo(f.combo)})`).join('、')
      window.$toast?.(`${desc} 已保存,只在应用内生效;想让它在后台也能用,请加上 Alt/Ctrl 等修饰键`, 'info', 6000)
    }
    if (!hard.length) return
    const desc = hard.map(f => `${names[f.action] || f.action}(${prettyCombo(f.combo)})`).join('、')
    const occupied = hard.some(f => f.reason === 'conflict')
    window.$toast?.(`${desc} 无法注册${occupied ? ',可能已被其他程序占用' : '(该按键组合不支持全局注册)'};应用内仍然可用`, 'warning', 6000)
  } catch (e) {
    window.$toast?.('快捷键注册失败:' + ((e && e.message) || ''), 'warning')
  }
}

// 恢复默认快捷键
function resetShortcuts() {
  shortcuts.value = { ...DEFAULT_SHORTCUTS }
  localStorage.setItem('soundflow_shortcuts', JSON.stringify(DEFAULT_SHORTCUTS))
  // 此前重置只改了本地存储与界面,没有重新注册 —— 旧快捷键的占用会一直留在系统里
  applyShortcuts()
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
  const f = customFonts.value[i]
  const name = f.name
  customFonts.value.splice(i, 1)
  localStorage.setItem('soundflow_custom_fonts', JSON.stringify(customFonts.value))
  if (currentFont.value.includes(name)) selectFont(systemFonts[0].value)
  // 以前只从列表里删条目,复制进来的字体文件永远留着 —— 只增不减,实测攒到 4 GB。
  // 交给主进程删,它只允许删字体目录内的文件(不信任渲染端传来的路径)
  try { window.electronAPI?.deleteFontFile?.(f.url) } catch {}
}

/**
 * 整理字体文件:用户指认"原件所在文件夹",把数据目录里与它同名的副本删掉,
 * 列表条目改指向原件 —— 一个字体都不丢,只是不再留冗余副本(实测释放 3.9 GB)。
 */
const fontTidy = ref({ busy: false })
async function tidyFonts() {
  if (!window.electronAPI?.tidyFonts) return
  if (!(await confirmDialog({
    message: '整理字体文件?',
    detail: '接下来选择一个"字体原件所在的文件夹":程序会把之前复制进数据目录的同名字体副本删除,并把字体列表改指向原件。字体本身不会丢,但如果之后把那个文件夹移走或改名,对应字体会失效。',
    confirmText: '选择文件夹'
  }))) return
  fontTidy.value.busy = true
  try {
    const res = await window.electronAPI.tidyFonts()
    if (!res) return // 用户在选择框里取消
    const n = Object.keys(res.remap || {}).length
    if (!n) { window.$toast?.('所选文件夹里没有同名文件,没有可整理的副本', 'info', 4000); return }
    customFonts.value = customFonts.value.map((f) => {
      const base = decodeURIComponent(String(f.url || '').split('/').pop() || '')
      return res.remap[base] ? { ...f, url: res.remap[base] } : f
    })
    localStorage.setItem('soundflow_custom_fonts', JSON.stringify(customFonts.value))
    window.$toast?.(`已整理 ${n} 个字体文件,释放 ${(res.freed / 1048576).toFixed(0)} MB`, 'success', 6000)
  } catch (e) {
    window.$toast?.('整理失败:' + (e && e.message), 'error', 5000)
  } finally {
    fontTidy.value.busy = false
  }
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

async function batchDownloadLyrics(only = null) {
  if (batchLyric.value.running || !window.electronAPI) return
  const songs = Array.isArray(only) && only.length ? only : musicStore.songs
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
    // 未匹配按原因分桶:超时/网络/音源异常/确实没有 —— 以前混成一个"未匹配",
    // 用户以为是自己歌冷门,其实多半是超时(重试就能成)
    whyTimeout: 0, whyNetwork: 0, whySource: 0, whyNone: 0,
    msg: '正在下载…', showResult: false, elapsed: '', finishedAt: '', folder,
    unmatched: []
  }

  // 并发 3:歌词源都是非官方接口,而且 auto 源内部已经是三个源并行取词 ——
  // 再乘 5 个 worker 就是对同一域名 15 路同时打(实测会被限流,整片返回 HTTP 错误)
  const CONCURRENCY = 3
  const lyricFolders = [...musicStore.lyricFolders] // 展开为纯数组(Proxy 无法过 IPC 序列化)
  let idx = 0
  let doneCount = 0
  let success = 0, skipped = 0, failed = 0, saveFail = 0, matchFail = 0
  let whyTimeout = 0, whyNetwork = 0, whySource = 0, whyNone = 0
  const unmatched = []

  async function worker() {
    while (true) {
      const i = idx++
      if (i >= songs.length) break
      const s = songs[i]
      try {
        const hasLocal = await window.electronAPI.readLyricFile(s.path, lyricFolders)
        // "有本地文件"要按"能不能解析出歌词"算 —— 一个空的/纯文本的 .lrc 会被当成
        // 已有歌词跳过,那首歌在播放页永远空着,而这里再也补不上了
        if (hasLocal && looksLikeLyrics(hasLocal)) {
          skipped++
        } else {
          const res = await window.electronAPI.searchOnlineLyric({
            title: s.title, artist: s.artist || '', duration: s.duration || 0,
            source: playerStore.lyricSource
          })
          if (res && res.lyrics) {
            const saved = await window.electronAPI.saveLyricToFolder(s.path, res.lyrics, folder)
            if (saved && saved.ok) success++
            else {
              saveFail++
              noteFailure('lyric.batch', '歌词写入失败', `${s.title} — ${(saved && saved.error) || '未知原因'}`)
            }
          } else {
            matchFail++
            unmatched.push(s)
            const err = res && res.error
            if (err === 'timeout') whyTimeout++
            else if (err === 'network') whyNetwork++
            else if (err === 'source') whySource++
            else whyNone++
            if (err && err !== 'notfound') {
              // 网络/超时/音源故障要留下原因:以前一律归到"没匹配到",用户以为是自己歌冷门
              const why = err === 'timeout' ? '取词超时' : (err === 'network' ? '取词失败:网络不可用' : '取词失败:音源返回异常')
              noteFailure('lyric.batch', why, `${s.title} — ${res.kind || ''}`)
            }
          }
        }
      } catch (e) {
        failed++
        noteFailure('lyric.batch', '批量下载单首异常', e)
      }
      doneCount++
      // 实时更新进度
      batchLyric.value.done = doneCount
      batchLyric.value.success = success
      batchLyric.value.skipped = skipped
      batchLyric.value.failed = failed
      batchLyric.value.saveFail = saveFail
      batchLyric.value.matchFail = matchFail
      batchLyric.value.whyTimeout = whyTimeout
      batchLyric.value.whyNetwork = whyNetwork
      batchLyric.value.whySource = whySource
      batchLyric.value.whyNone = whyNone
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, songs.length) }, () => worker()))
    const elapsedMs = Date.now() - startTime
    const now = new Date()
    batchLyric.value.elapsed = fmtElapsed(elapsedMs)
    batchLyric.value.finishedAt = now.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    batchLyric.value.msg = ''
    batchLyric.value.unmatched = unmatched
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

.settings-content { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--page-pad-x) var(--page-pad-x); }
/* 超宽屏下标签与开关此前相距近 1800px,阅读时要横跨整屏 —— 限制内容宽度并居中 */
.settings-content > * { max-width: 1040px; margin-left: auto; margin-right: auto; }
@media (max-width: 1100px) {
  /* 窄窗:标签与控件改为纵向排列,长中文标签不再被挤成两行 */
  .setting-item { flex-direction: column; align-items: flex-start; gap: 8px; }
}

.settings-section {
  margin-bottom: var(--gap-section); background: var(--bg-card); border: 1px solid var(--border-color);
  border-radius: var(--radius-lg); padding: 18px 20px;
  transition: box-shadow var(--transition-fast), border-color var(--transition-fast);
}
.settings-section:hover { box-shadow: var(--shadow-sm); border-color: var(--panel-border, var(--border-color)); }
.section-title {
  font-size: var(--font-size-sm); font-weight: 600; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 7px;
}
/* 分区标题主色竖条(分组视觉统一) */
.section-desc { font-size: var(--font-size-xs); color: var(--text-tertiary); margin: -6px 0 10px; }
.section-title::before {
  content: '';
  width: 3px; height: 14px; border-radius: 2px;
  background: var(--color-primary);
  box-shadow: 0 0 6px var(--color-primary-alpha);
  flex-shrink: 0;
}

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
  display: flex; align-items: center; justify-content: space-between;  padding: 13px 10px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin: 0 -6px;
  transition: background var(--transition-fast);
}
.setting-item:hover { background: var(--bg-hover); }
.setting-item:last-child { border-bottom: none; }

.setting-label { flex: 1; }
.label-text { font-size: var(--font-size-base); color: var(--text-primary); font-weight: 500; }
.label-desc { font-size: var(--font-size-xs); color: var(--text-tertiary); margin-left: 8px; }
/* 快捷键作用范围说明:默认只在应用内生效,录制的组合才注册到系统级 —— 必须让用户看见 */
.shortcut-scope-hint {
  font-size: var(--font-size-xs); color: var(--text-secondary); line-height: 1.7;
  margin: 8px 0 12px; padding: 8px 10px; border-radius: 6px;
  background: var(--bg-hover, rgba(127,127,127,0.08));
}
.shortcut-scope-hint strong { color: var(--text-primary); font-weight: 600; }

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
.deepseek-key-input { width: 100%; margin-top: 8px; }
.deepseek-key-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; position: relative; }
.deepseek-key-row .deepseek-key-input { flex: 1; margin-top: 0; }
.key-eye { flex-shrink: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: var(--bg-hover); border: 1px solid var(--border-color); border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; }
.key-eye:hover { border-color: var(--color-primary); }
.key-configured { flex-shrink: 0; font-size: 11px; color: var(--color-success, #42c988); font-weight: 500; }
.font-row { display: flex; align-items: center; gap: 10px; }
.font-select {
  flex: 1; padding: 7px 10px; font-size: var(--font-size-sm);
  background: var(--bg-card); color: var(--text-primary);
  border: 1px solid var(--border-color); border-radius: var(--radius-md);
}
.custom-font-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; }
.font-name { font-size: var(--font-size-sm); color: var(--text-primary); }
.font-remove { padding: 3px 10px; font-size: var(--font-size-xs); }
/* 整理字体文件:按钮 + 说明(说明走 token 色,浅色主题下也要能读) */
.font-tidy-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.font-tidy-row .setting-hint { flex: 1; min-width: 220px; font-size: var(--font-size-xs); color: var(--text-secondary); line-height: 1.5; }
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

/* 音效滑块面板已删除(与播放栏的音效面板重复),这里只留总开关 */
.batch-progress-track { width: 100%; height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden; }
.batch-progress-fill { height: 100%; background: var(--color-primary); border-radius: 3px; transition: width 0.2s; }

.batch-done-overlay {
  position: fixed; inset: 0; background: var(--overlay-mask, rgba(0,0,0,0.45));
  display: flex; align-items: center; justify-content: center; z-index: var(--z-modal);
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
.save-queue-mask {
  position: fixed; inset: 0; z-index: var(--z-nested);
  background: var(--overlay-mask, rgba(0,0,0,0.5));
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.save-queue-card {
 
}
.lyric-mgr-card { width: 460px; max-width: 90vw; max-height: 72vh; display: flex; flex-direction: column; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; color: var(--text-primary); padding: 18px; }
.lyric-mgr-card h3 { margin: 0 0 10px; font-size: 16px; }
.lyric-mgr-stats { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.lyric-mgr-list { flex: 1; overflow-y: auto; margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
.lyric-mgr-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; }
.lyric-mgr-row:hover { background: var(--bg-hover); }
.lyric-mgr-info { flex: 1; min-width: 0; }
.lyric-mgr-title { font-size: 13px; color: var(--text-primary); }
.lyric-mgr-artist { font-size: 11px; color: var(--text-secondary); }
.lyric-mgr-status { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--color-danger-alpha, rgba(255,143,143,0.15)); color: var(--color-danger, #ff8f8f); flex-shrink: 0; }
.lyric-mgr-status.ok { background: var(--color-success-alpha, rgba(80,220,140,0.15)); color: var(--color-success, #50dc8c); }
.lyric-mgr-del { background: none; border: none; cursor: pointer; font-size: 13px; opacity: 0.6; }
.lyric-mgr-del:hover { opacity: 1; }
/* 搜索过滤:用 class 而非内联 style,避免与 Vue 的渲染互抢 DOM。
   容器带 .searching 时,未标记 search-hit / search-any 的一律隐藏 —— 这样过滤期间
   才被 v-if 渲染出来的条目也会默认隐藏,不会漏出来。 */
.settings-content.searching .setting-item:not(.search-hit) { display: none; }
.settings-content.searching .settings-section:not(.search-any) { display: none; }
</style>
