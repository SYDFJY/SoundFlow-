<template>
  <div class="player-view" :style="[bgStyle, { '--bg-bright': bgBrightness + '%' }]" :data-bg="bgMode" @wheel="onViewWheel">
    <div class="player-overlay" :class="{ 'overlay-theme': bgMode === 'theme' }">
      <!-- 顶部栏 -->
      <div class="player-topbar">
        <button class="back-btn" @click="goBack">
          <Icon name="back" :size="16" />
          <span>{{ t('playerView.back') }}</span>
        </button>
        <div class="tab-switcher">
          <button class="tab-btn" :class="{ active: activeTab === 'cover' }" @click="activeTab = 'cover'">{{ t('playerView.cover') }}</button>
          <button class="tab-btn" :class="{ active: activeTab === 'lyric' }" @click="activeTab = 'lyric'">{{ t('playerView.lyrics') }}</button>
        </div>
        <div class="topbar-right">
          <button class="icon-btn" @click="showBgPanel = !showBgPanel" v-tooltip:bottom="'播放页背景设置'">
            <Icon name="cover" :size="18" />
          </button>
        </div>
        <!-- 背景设置面板 -->
        <div v-if="showBgPanel" class="bg-panel" @click.stop>
          <div class="panel-title">播放页背景</div>
          <!-- 四个模式:主题(跟随皮肤) / 封面(封面铺底) / 纯色(可自由取色) / 自定义图片。
               此前的「主色」与「封面」视觉重叠(都是跟着封面走),「渐变」只能从 5 条写死的
               配色里挑、用户改不了 —— 已移除,渐变存档会自动迁移到纯色。 -->
          <div class="bg-mode-btns">
            <button :class="{ active: bgMode === 'theme' }" @click="setBgMode('theme')">主题</button>
            <button :class="{ active: bgMode === 'cover' }" @click="setBgMode('cover')">{{ t('playerView.cover') }}</button>
            <button :class="{ active: bgMode === 'color' }" @click="setBgMode('color')">纯色</button>
            <button :class="{ active: bgMode === 'image' }" @click="setBgMode('image')">自定义图片</button>
          </div>
          <div v-if="bgMode === 'color'" class="color-row">
            <button v-for="c in bgPresets.color" :key="c.value" class="color-dot" :style="{ background: c.value }" :class="{ active: bgColor === c.value }" :title="c.name" @click="setBgColor(c.value)"></button>
            <!-- 自定义取色:复用项目已引入的 pickr(歌词色板同款) -->
            <button class="color-dot color-dot-custom" ref="bgColorPickrEl" :style="{ background: bgColor }" :class="{ active: bgColorIsCustom }" title="自定义取色" aria-label="自定义背景色" @click="openBgColorPicker"></button>
          </div>
          <div v-else-if="bgMode === 'image'" class="bg-image-actions">
            <button class="bg-import-btn" @click="importBgImage"><Icon name="cover" :size="14" />导入自定义图片</button>
            <button v-if="bgImageUrl" class="bg-clear-btn" @click="clearBgImage">清除(恢复封面)</button>
            <div v-if="bgImageUrl" class="bg-image-preview" :style="{ backgroundImage: `url(${bgImageUrl})` }"></div>
          </div>
          <div class="bg-bright-row">
            <span class="bg-bright-label">背景亮度</span>
            <input class="h-slider bg-bright-slider" type="range" min="70" max="140" step="5" :value="bgBrightness" @input="setBgBrightness($event.target.value)" />
            <span class="bg-bright-val">{{ bgBrightness }}%</span>
          </div>
        </div>
      </div>

      <!-- 封面模式 -->
      <div v-if="activeTab === 'cover'" key="cover" class="cover-mode" :class="{ split: useSplit }">
        <div class="cover-left">
        <!-- 分栏:方形封面 + 半露旋转 CD(文档风格) -->
        <div v-if="useSplit" class="album-stage">
          <div class="album-art" @dblclick.stop="toggleFullscreen">
            <img v-if="coverUrl" :src="coverUrl" :class="{ 'img-loading': !coverLoaded }" @load="coverLoaded = true" @error="onCoverError" alt="" />
            <div v-else class="cover-placeholder"><Icon name="music" :size="36" /></div>
          </div>
          <div class="cd-wrap">
            <div class="cd-half" :class="{ spinning: playerStore.isPlaying }" :key="'cd-' + (playerStore.currentSong?.path || 'none')">
              <img v-if="coverUrl" :src="coverUrl" :class="{ 'img-loading': !coverLoaded }" @load="coverLoaded = true" @error="onCoverError" alt="" />
            </div>
          </div>
        </div>
        <div v-else class="disc-area" title="点击进入歌词" @click="activeTab = 'lyric'" @dblclick.stop="toggleFullscreen">
          <!-- 圆形环绕频谱:移入 disc-area 内,圆心=唱片圆心 -->
          <canvas v-show="specMode !== 'bar'" ref="spectrumRingCanvas" class="spectrum-ring"></canvas>
          <div class="disc-ring" :class="{ spinning: playerStore.isPlaying }">
            <div class="disc-cover" :key="playerStore.currentSong?.path || 'none'" :class="{ 'switch-anim': switchAnim }">
              <img v-if="coverUrl" :src="coverUrl" :class="{ 'img-loading': !coverLoaded }" @load="coverLoaded = true" @error="onCoverError" alt="" />
              <div v-else class="cover-placeholder"><Icon name="music" :size="36" /></div>
            </div>
          </div>
        </div>
        <div class="song-meta" :key="'meta-' + (playerStore.currentSong?.path || 'none')" :class="{ 'switch-anim': switchAnim }" @animationend="onSwitchAnimEnd">
          <h2 class="song-title">{{ playerStore.currentSong?.title || t('player.notPlaying') }}</h2>
          <div class="song-artist">{{ playerStore.currentSong?.artist || '' }}</div>
          <div class="song-album">{{ playerStore.currentSong?.album || '' }}</div>
          <!-- 音质信息:原来只有一行「码率 · 采样率」,常见追问(位深?转码了吗?响度均衡生效了吗?)
               只能靠猜。折成一行关键指标 + 悬停展开完整说明,不占版面。 -->
          <div v-if="currentSongInfo.length" class="song-info" :title="infoTitle" tabindex="0">
            <span v-for="(p, i) in currentSongInfo" :key="i" class="si-part" :class="p.tone">{{ p.text }}</span>
          </div>
          <div v-if="playerStore.currentSong && hasCoverAPI" class="cover-actions">
            <button class="cover-swap" @click="swapCover"><Icon name="cover" :size="14" />{{ t('playerView.coverChange') }}</button>
            <button v-if="hasCustomCover" class="cover-swap" @click="restoreCover"><Icon name="refresh" :size="14" />{{ t('playerView.coverRestore') }}</button>
          </div>
        </div>
        </div>
        <!-- 大屏分栏:右侧歌词(整行高亮,点击跳转) -->
        <div v-if="useSplit" class="split-lyrics" ref="splitLyricsEl">
          <div class="lyrics-scroll">
            <div v-if="playerStore.lyrics.length === 0" class="lyrics-empty">
              <div class="es-icon"><Icon name="lyrics" :size="44" /></div>
              <div>{{ t('playerView.noLyrics') }}</div>
            </div>
            <div v-else class="lyrics-content" :class="{ 'no-lyric-effect': !lyricEffect }">
              <div style="height:30%"></div>
              <!-- 与歌词页共用 LyricLine:逐字/翻译不再只在歌词页生效(分栏窄,不显示时间戳列) -->
              <LyricLine
                v-for="(line, idx) in playerStore.lyrics" :key="idx"
                :line="line" :idx="idx" :current-idx="playerStore.currentLyricIndex"
                :effect="lyricEffect" :align="lyricAlign" :font-size="lyricFontSize" :gap="lyricLineGap"
                :color="lyricLineColor(idx)" :shadow="lyricLineShadow(idx)"
                :word-mode="lyricMode === 'word'"
                :words="idx === playerStore.currentLyricIndex ? lyricWordSegments(line) : []"
                :word-idx="currentWordIdx" :word-color="lyricColor"
                :translation="playerStore.translationFor(idx)"
                @seek="seekToLine"
              />
              <div style="height:30%"></div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="activeTab !== 'cover'" key="lyric" class="lyric-mode">
        <div class="lyric-left">
          <div class="disc-small" :class="{ spinning: playerStore.isPlaying }" title="返回封面" @click="activeTab = 'cover'">
            <div class="disc-cover-small">
              <img v-if="coverUrl" :src="coverUrl" :class="{ 'img-loading': !coverLoaded }" @load="coverLoaded = true" @error="onCoverError" alt="" />
              <div v-else class="cover-placeholder"><Icon name="music" :size="36" /></div>
            </div>
          </div>
          <div class="song-meta-small">
            <h2 class="song-title-sm">{{ playerStore.currentSong?.title || t('player.notPlaying') }}</h2>
            <div class="song-artist-sm">{{ playerStore.currentSong?.artist || '' }}</div>
          </div>
        </div>
        <div class="lyric-right">
          <div class="lyrics-scroll" ref="lyricsPanel">
            <div v-if="playerStore.lyricOrigin" class="lyric-origin-tag" :class="{ 'is-problem': lyricOriginIsProblem }">
              {{ lyricOriginText }}
              <button v-if="playerStore.lyricOrigin === '本地'" class="ls-del-btn" title="删除本地歌词" @click="deleteLocalLyric"><Icon name="remove" :size="13" /></button>
            </div>
            <div v-if="playerStore.lyrics.length === 0" class="lyrics-empty">
              <template v-if="playerStore.lyricLoading">
                <!-- 加载动效取自 uiverse.io(MIT,by Fadhilmagass),颜色尺寸已改为主题 token -->
                <div class="lyric-loading-tip"><span class="sf-dots"><i></i><i></i><i></i><i></i><i></i></span>歌词加载中…</div>
              </template>
              <template v-else>
                <div class="es-icon"><Icon name="lyrics" :size="44" /></div>
                <div>{{ t('playerView.noLyrics') }}</div>
                <div class="empty-hint">右键歌曲可导入 .lrc 文件<br/>或在设置中添加歌词文件夹</div>
                <button class="search-lyric-btn" :class="{ 'is-loading': searchingLyric }" :disabled="searchingLyric" @click="searchLyric">
                  {{ searchingLyric ? '正在搜索…' : '在线搜索歌词并下载' }}
                </button>
                <button class="search-lyric-btn local" @click="importLocalLyric"><Icon name="lyrics" :size="14" />导入本地歌词文件</button>
                <div v-if="searchLyricMsg" class="search-lyric-msg">{{ searchLyricMsg }}</div>
              </template>
            </div>
            <div v-else class="lyrics-content" :class="{ 'no-lyric-effect': !lyricEffect }">
              <div style="height:40%"></div>
              <!-- 与封面分栏共用 LyricLine(此处多一个行时间戳列) -->
              <LyricLine
                v-for="(line, idx) in playerStore.lyrics" :key="idx"
                :line="line" :idx="idx" :current-idx="playerStore.currentLyricIndex"
                :effect="lyricEffect" :align="lyricAlign" :font-size="lyricFontSize" :gap="lyricLineGap"
                :color="lyricLineColor(idx)" :shadow="lyricLineShadow(idx)"
                :time-text="playerStore.formatTime(line.time)"
                :word-mode="lyricMode === 'word'"
                :words="idx === playerStore.currentLyricIndex ? lyricWordSegments(line) : []"
                :word-idx="currentWordIdx" :word-color="lyricColor"
                :translation="playerStore.translationFor(idx)"
                @seek="seekToLine"
              />
              <div style="height:40%"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 显示条件:歌词页恒显示;封面页只在「分栏」时显示(单栏封面没有歌词);
           分栏那一屏右半边就是歌词,所以这组控制同样适用 -->
      <div v-if="showLyricToolbar" class="lyric-toolbar-layer">
        <!-- 歌词工具栏:按「来源 / 外观 / 字号行距 / 同步」分组。
             两处改动的原因:
               1. 挂载层级 —— 此前写在 .lyric-mode > .lyric-right 内部,于是
                  「分栏」那一屏(封面与歌词并排的同一个界面)完全没有这组控制;
               2. 分组与图标 —— 改造前 14 个按钮挤成一列,文案(对齐/逐字/A−/A+)
                  与 emoji(🎨✨)、几何符号(⭱⭳⇤⇥)混排,既没有分组也没有
                  aria-pressed,用户看不出哪个是「来源」哪个是「字号」。 -->
        <div
          class="lyric-source-switch"
          :class="{ collapsed: lyricSidebarCollapsed }"
          role="toolbar"
          aria-orientation="vertical"
          :aria-label="lyricSidebarCollapsed ? '歌词工具栏(已收起)' : '歌词工具栏'"
          @keydown="onSidebarKeydown"
        >
          <button
            class="ls-btn ls-collapse"
            :title="lyricSidebarCollapsed ? '展开歌词工具栏' : '收起歌词工具栏'"
            :aria-label="lyricSidebarCollapsed ? '展开歌词工具栏' : '收起歌词工具栏'"
            :aria-expanded="!lyricSidebarCollapsed"
            @click="toggleLyricSidebar"
          ><Icon :name="lyricSidebarCollapsed ? 'back' : 'forward'" :size="14" /></button>

          <template v-if="!lyricSidebarCollapsed">
            <div class="ls-group-label">来源</div>
            <button
              v-for="opt in playerStore.LYRIC_SOURCE_OPTIONS" :key="opt.value"
              class="ls-btn" :class="{ active: playerStore.lyricSource === opt.value }"
              :aria-pressed="playerStore.lyricSource === opt.value"
              :title="'歌词来源:' + opt.label"
              @click="playerStore.changeLyricSource(opt.value)"
            >{{ opt.label }}</button>

            <div class="ls-sep" aria-hidden="true"></div>
            <div class="ls-group-label">外观</div>
            <button class="ls-btn" :class="{ active: showColorPanel }" :aria-pressed="showColorPanel" title="歌词颜色" aria-label="歌词颜色" @click="showColorPanel = !showColorPanel"><Icon name="color" :size="15" /></button>
            <button class="ls-btn" :class="{ active: playerStore.showTranslation, 'is-loading': playerStore.translating }" :aria-pressed="playerStore.showTranslation" v-tooltip:top="playerStore.translating ? '翻译中…' : '歌词翻译'"aria-label="歌词翻译" @click="playerStore.toggleTranslation()"><Icon name="translate" :size="15" /></button>
            <button class="ls-btn" :class="{ active: lyricAlign === 'left' }" :aria-pressed="lyricAlign === 'left'" :title="lyricAlign === 'left' ? '当前左对齐,点击改为居中' : '当前居中,点击改为左对齐'" aria-label="歌词对齐方式" @click="toggleLyricAlign"><Icon name="swap" :size="15" /></button>
            <button class="ls-btn" :class="{ active: lyricEffect }" :aria-pressed="lyricEffect" title="歌词特效(远近变淡/发光)" aria-label="歌词特效" @click="toggleLyricEffect"><Icon name="effect" :size="15" /></button>
            <button class="ls-btn" :class="{ active: lyricMode === 'word' }" :aria-pressed="lyricMode === 'word'" :title="'歌词高亮: ' + (lyricMode === 'word' ? '逐字(点击改为整行)' : '整行(点击改为逐字)')" aria-label="歌词高亮方式" @click="toggleLyricMode">{{ lyricMode === 'word' ? '逐字' : '整行' }}</button>

              <div class="ls-sep" aria-hidden="true"></div>
              <!-- 字号 / 行距 / 偏移 三组连续参数收进弹出面板:
                   原先占 7 个按钮 + 2 个分组标题,竖条长到近半屏;改成滑杆后
                   一眼能看到当前值,也能拖动连续调整(点按 A−/A+ 要按很多次) -->
              <button
                class="ls-btn" :class="{ active: showFormatPanel }" :aria-pressed="showFormatPanel"
                :aria-expanded="showFormatPanel"
                title="歌词排版(字号 / 行距 / 时间偏移)" aria-label="歌词排版"
                @click="showFormatPanel = !showFormatPanel"
              ><Icon name="settings" :size="15" /></button>
          </template>
        </div>
        <!-- 歌词排版面板:字号 / 行距 / 偏移。与色板同构,锚在竖条左侧 -->
        <div v-if="showFormatPanel" class="format-panel" @click.stop>
          <div class="fp-title">歌词排版</div>
          <div class="fp-row">
            <span class="fp-label">字号</span>
            <input class="h-slider fp-slider" type="range" min="12" max="36" step="1" :value="lyricFontSize" aria-label="歌词字号" @input="setLyricFont(+$event.target.value)" />
            <span class="fp-val">{{ lyricFontSize }}</span>
          </div>
          <div class="fp-row">
            <span class="fp-label">行距</span>
            <input class="h-slider fp-slider" type="range" min="1.3" max="2.4" step="0.05" :value="lyricLineGap" aria-label="歌词行距" @input="setLyricGap(+$event.target.value)" />
            <span class="fp-val">{{ lyricLineGap.toFixed(2) }}</span>
          </div>
          <div class="fp-row">
            <span class="fp-label">偏移</span>
            <input class="h-slider fp-slider" type="range" min="-1000" max="1000" step="20" :value="playerStore.lyricUserOffsetMs || 0" aria-label="歌词时间偏移(毫秒)" @input="slideLyricOffset(+$event.target.value)" @change="playerStore.setLyricUserOffset(+$event.target.value)" />
            <span class="fp-val">{{ lyricOffsetLabel }}</span>
          </div>
          <div class="fp-sub">
            <button class="fp-mini" title="提前 0.1 秒" aria-label="歌词提前 0.1 秒" @click="playerStore.nudgeLyricOffset(-100)"><Icon name="back" :size="13" /></button>
            <button class="fp-mini" :disabled="!playerStore.lyricUserOffsetMs" title="偏移归零" aria-label="偏移归零" @click="playerStore.resetLyricUserOffset()">归零</button>
            <button class="fp-mini" title="延后 0.1 秒" aria-label="歌词延后 0.1 秒" @click="playerStore.nudgeLyricOffset(100)"><Icon name="forward" :size="13" /></button>
          </div>
          <div class="fp-hint">偏移按曲记忆,换歌自动读回</div>
        </div>
        <!-- 歌词颜色面板:跟随按钮组左侧 -->
        <div v-if="showColorPanel" class="color-panel" @click.stop>
          <div class="color-panel-title">歌词颜色</div>
          <button v-for="c in lyricColorOptions" :key="c.value" class="color-dot" :style="{ background: c.value }" :class="{ active: lyricColor === c.value }" :title="c.name" @click="setLyricColor(c.value)"></button>
          <button class="color-dot color-dot-custom" ref="lyricColorPickrEl" :style="{ background: lyricColor }" :class="{ active: lyricIsCustom }" title="自定义取色" @click="openLyricPicker"></button>
        </div>
      </div>
      <!-- 音频频谱:独立于面板常驻(切 tab 不销毁,即时恢复跳动);封面界面下方显示,歌词界面隐藏不占位 -->
      <canvas v-show="activeTab === 'cover' && (specMode !== 'ring' || useSplit)" ref="spectrumCanvas" class="spectrum-bar"></canvas>

      <!-- 底部控制栏 -->
      <div class="player-controls">
        <div class="controls-row">
          <!-- 左工具组(桌面歌词/迷你/音量) -->
          <div class="tools-group-left">
<!-- 桌面歌词 -->
            <button class="ctrl-btn ctrl-btn--small" :class="{ active: playerStore.desktopLyricState !== 0 }" @click="playerStore.cycleDesktopLyric()" :title="t('player.lyrics')">
              <Icon name="lyrics" :size="18" />

            </button>

            <!-- 迷你播放器 -->
            <button class="ctrl-btn ctrl-btn--small" :class="{ active: playerStore.miniOpen }" @click="toggleMini" title="迷你播放器(独立小窗)">
              <Icon name="miniPlayer" :size="18" />
            </button>

            <!-- 音量(默认收起,点击图标展开滑块) -->
            <div class="volume-control" :class="{ expanded: playerStore.volPanelOpen }">
              <button class="vol-btn" @click="playerStore.volPanelOpen = !playerStore.volPanelOpen" :title="t('player.volume')">
                <Icon v-if="playerStore.isMuted || playerStore.volume === 0" name="mute" :size="18" />
                <Icon v-else name="volume" :size="18" />
              </button>
              <transition name="vol-fade">
                <div v-if="playerStore.volPanelOpen" class="vol-pop pop-panel">
                  <div class="vol-pct">{{ Math.round(playerStore.volume * 100) }}%</div>
                  <input type="range" class="vol-slider" min="0" max="1" step="0.01" :value="playerStore.volume" @input="setVolume" @pointerdown="volDragStart" @pointerup="volDragEnd" />
                  <div class="vol-input-row">
                    <input v-model.number="volInput" type="number" min="0" max="100" class="vol-input no-spinner" @keydown.enter="confirmVolInput" @blur="confirmVolInput" />
                    <span class="vol-input-unit">%</span>
                  </div>
                </div>
              </transition>
            </div>
          </div>

<!-- 播放控制组(居中:播放模式/上一曲/播放/下一曲/倍速,与播放栏一致) -->
          <div class="controls-group">
            <!-- 占位块:让"模式/上一曲/播放/下一曲"这组在整行里保持居中(右侧有倍速+变调两个按钮) -->
            <div class="ctrl-sym-spacer" aria-hidden="true"></div>
            <div class="mode-control">
              <button class="ctrl-btn ctrl-mode" :aria-label="playModeLabel" :aria-expanded="showModePanel" @click="showModePanel = !showModePanel" v-tooltip:top="playModeLabel + ' — 点击选择播放模式'">
                <Icon :name="currentModeIcon" :size="18" />
              </button>
              <transition name="fade">
                <div v-if="showModePanel" class="mode-panel pop-panel" @click.stop>
                  <button v-for="m in playerStore.PLAY_MODES" :key="m.key" class="mode-item" :class="{ active: playerStore.playMode === m.key }" :aria-pressed="playerStore.playMode === m.key" @click="pickPlayMode(m.key)">
                    <Icon :name="m.icon" :size="16" />
                    <span>{{ t(m.labelKey) }}</span>
                    <Icon v-if="playerStore.playMode === m.key" class="mode-check" name="check" :size="14" />
                  </button>
                </div>
              </transition>
            </div>
            <div class="hint-wrap" @mouseenter="showPrevHint = true" @mouseleave="showPrevHint = false">
              <button class="ctrl-btn ctrl-prev" @click="playerStore.playPrev()" title="上一曲" aria-label="上一曲">
                <Icon name="prev" :size="20" fill="currentColor" />
              </button>
              <TrackHint :show="showPrevHint" direction="prev" />
            </div>
            <button class="ctrl-btn ctrl-btn--play" @click="playerStore.togglePlay()" v-tooltip:top="playerStore.isBuffering ? '缓冲中' : ((playerStore.isPlaying ? '暂停' : '播放') + shortcutHint('playPause'))">
              <span v-if="playerStore.isBuffering" class="sf-dots sf-dots--sm" aria-label="缓冲中"><i></i><i></i><i></i><i></i><i></i></span>
              <Icon v-else-if="playerStore.isPlaying" name="pause" :size="22" fill="currentColor" />
              <Icon v-else name="play" :size="22" fill="currentColor" />
            </button>
            <div class="hint-wrap" @mouseenter="showNextHint = true" @mouseleave="showNextHint = false">
              <button class="ctrl-btn ctrl-next" @click="playerStore.playNext()" title="下一曲" aria-label="下一曲">
                <Icon name="next" :size="20" fill="currentColor" />
              </button>
              <!-- 与播放栏共用同一张预览卡(此前只有播放栏有,播放页没有) -->
              <TrackHint :show="showNextHint" />
            </div>
            <!-- 倍速(自定义) -->
            <div class="rate-control">
              <button class="ctrl-btn ctrl-btn--small" :class="{ active: playerStore.playbackRate !== 1 }" @click="showRatePanel = !showRatePanel" :title="t('player.rate', { x: playerStore.playbackRate })">
                {{ playerStore.playbackRate }}x
              </button>
              <transition name="vol-fade">
                <div v-if="showRatePanel" class="rate-panel pop-panel" @click.stop>
                  <div class="pitch-header"><span>播放速度</span></div>
                  <div class="pitch-val-big">{{ playerStore.playbackRate }}x</div>
                  <input type="range" class="h-slider pitch-slider" min="0.25" max="3" step="0.05" :value="playerStore.playbackRate" @input="playerStore.setPlaybackRate(+$event.target.value)" />
                  <div class="pitch-presets">
                    <button v-for="r in [0.5, 0.75, 1, 1.25, 1.5, 2, 3]" :key="r" class="pitch-preset" :class="{ active: Math.abs(playerStore.playbackRate - r) < 0.001 }" @click="playerStore.setPlaybackRate(r)">{{ r }}x</button>
                  </div>
                  <div class="pitch-scale"><span>0.25x</span><span>3x</span></div>
                  <div class="pitch-actions">
                    <div class="pitch-input-group">
                      <input v-model.number="rateInput" type="number" min="0.25" max="3" step="0.05" class="vol-input no-spinner" @keydown.enter="confirmRateInput" @blur="confirmRateInput" />
                      <span>x</span>
                    </div>
                    <button class="pitch-reset" @click="playerStore.setPlaybackRate(1)">重置 1x</button>
                  </div>
                </div>
              </transition>
            </div>

            <!-- 变调(升降调,与倍速独立同时生效) -->
            <div class="pitch-control">
              <button class="ctrl-btn ctrl-btn--small" :class="{ active: playerStore.pitch !== 0 }" @click="showPitchPanel = !showPitchPanel" :title="t('playerView.pitch')">
                {{ playerStore.pitch > 0 ? '+' : '' }}{{ playerStore.pitch }} st
              </button>
              <transition name="vol-fade">
                <div v-if="showPitchPanel" class="pitch-panel pop-panel" @click.stop>
                  <div class="pitch-header"><span>音调</span></div>
                  <div class="pitch-val-big" :class="{ 'pitch-val-big--active': playerStore.pitch !== 0 }">{{ playerStore.pitch > 0 ? '+' : '' }}{{ playerStore.pitch }} st</div>
                  <input type="range" class="h-slider pitch-slider" min="-12" max="12" step="1" :value="playerStore.pitch" @input="playerStore.setPitch(+$event.target.value)" />
                  <div class="pitch-presets">
                    <button v-for="p in [-12, -7, -5, -3, 0, 3, 5, 7, 12]" :key="p" class="pitch-preset" :class="{ active: playerStore.pitch === p }" @click="playerStore.setPitch(p)">{{ p > 0 ? '+' : '' }}{{ p }}</button>
                  </div>
                  <div class="pitch-scale"><span>-12</span><span>0</span><span>+12</span></div>
                  <div class="pitch-actions">
                    <div class="pitch-input-group">
                      <input v-model.number="pitchInput" type="number" min="-12" max="12" class="vol-input no-spinner" @keydown.enter="confirmPitchInput" @blur="confirmPitchInput" />
                      <span>st</span>
                    </div>
                    <button class="pitch-reset" @click="playerStore.setPitch(0)">重置 0</button>
                  </div>
                </div>
              </transition>
            </div>
          </div>
          <!-- 右工具组(分栏 / 音效 / 频谱 / 播放列表) -->
          <div class="tools-group">
<!-- 分栏切换(大屏封面+歌词并排) -->
            <button class="ctrl-btn ctrl-btn--small" :class="{ active: useSplit }" @click="toggleSplit" v-tooltip:top="'分栏/单栏切换(封面与歌词并排)'">
              <Icon name="splitView" :size="18" />
            </button>
            <!-- 音效 -->
            <button class="ctrl-btn ctrl-btn--small" :class="{ active: showEqPanel || playerStore.eqSettings.enabled }" @click="showEqPanel = !showEqPanel" v-tooltip:top="t('player.eq')">
              <Icon name="equalizer" :size="18" />
            </button>
            <!-- 频谱模式与密度 -->
            <div class="spec-control">
              <button class="ctrl-btn ctrl-btn--small" :class="{ active: showSpecPanel || specMode !== 'bar' }" @click="showSpecPanel = !showSpecPanel" title="频谱设置(模式/柱数密度)">
                {{ ({ bar: '频谱', ring: '圆谱', both: '双谱' })[specMode] }}
              </button>
              <transition name="vol-fade">
                <div v-if="showSpecPanel" class="spec-panel pop-panel" @click.stop>
                  <div class="pitch-header"><span>频谱</span></div>
                  <div class="spec-group">
                    <div class="spec-group-name">模式</div>
                    <div class="spec-opts">
                      <button v-for="m in SPEC_MODES" :key="m.v" class="pitch-preset" :class="{ active: specMode === m.v }" @click="specMode = m.v; localStorage.setItem('soundflow_spec_mode', m.v)">{{ m.l }}</button>
                    </div>
                  </div>
                  <div v-if="useSplit && specMode === 'ring'" class="spec-group">
                    <div class="spec-group-note">分栏布局没有圆形频谱(它画在唱片外圈),这一侧用柱状显示</div>
                  </div>
                  <div class="spec-group">
                    <div class="spec-group-name">柱数密度</div>
                    <div class="spec-opts">
                      <button v-for="d in SPEC_DENSITIES" :key="d.n" class="pitch-preset" :class="{ active: barCount === d.n }" @click="setSpecDensity(d.n)">{{ d.l }}</button>
                    </div>
                  </div>
                </div>
              </transition>
            </div>

            <!-- 播放列表 -->
            <button class="ctrl-btn ctrl-btn--small" data-queue-toggle :class="{ active: showQueuePanel }" @click="toggleQueuePanel" v-tooltip:top="t('player.queue')">
              <Icon name="queue" :size="18" />
            </button>
          </div>
        </div>

        <!-- 音效面板 -->
        <transition name="queue-slide">
          <EqPanel v-if="showEqPanel" :show="showEqPanel" @close="showEqPanel = false" />
        </transition>
        <div class="progress-row">
          <button class="seek-jump" title="快退 10 秒" @click="jumpSeek(-10)">
            <Icon name="rewind" :size="18" />
          </button>
          <ProgressBar />
          <button class="seek-jump" title="快进 10 秒" @click="jumpSeek(10)">
            <Icon name="fastForward" :size="18" />
          </button>
          <!-- A-B 循环:点一次设 A,再点设 B 并立刻回到 A,第三次取消。
               三种态在按钮文案上直接可读,不靠颜色让人猜 -->
          <button
            class="ab-btn"
            :class="'ab-btn--' + playerStore.abState"
            :aria-pressed="playerStore.abState === 'active'"
            :title="abTitle"
            :aria-label="abTitle"
            @click="playerStore.cycleAB()"
          >
            <span class="ab-dot" :class="{ on: playerStore.abState !== 'off' }">A</span>
            <span class="ab-dot" :class="{ on: playerStore.abState === 'active' }">B</span>
          </button>
        </div>

        <!-- 播放列表面板(打开自动定位当前歌曲) -->
        <transition name="queue-slide">
          <QueuePanel v-if="showQueuePanel" :show="showQueuePanel" @close="showQueuePanel = false" />
        </transition>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from '@/stores/playerStore'
import { useMusicStore } from '@/stores/musicStore'
import { useRouter } from 'vue-router'
import { t } from '@/i18n'
import ProgressBar from '@/components/ProgressBar.vue'
import EqPanel from '@/components/EqPanel.vue'
import TrackHint from '@/components/TrackHint.vue'
import QueuePanel from '@/components/QueuePanel.vue'
import { useVolumeControl } from '@/composables/useVolumeControl'
import { buildWordSegments, wordIndexAt } from '@/utils/lyricTiming'
import { mergeTranslatedLRC } from '@/utils/lrc'
import { lyricLineColor as lineColor, lyricLineShadow as lineShadow } from '@/utils/lyricStyle'
import { isCustomCoverUrl } from '@/utils/cover'
import { shortcutHint } from '@/utils/shortcut'
import LyricLine from '@/components/LyricLine.vue'
import { useSpectrum } from '@/composables/useSpectrum'
import { usePlayerBackground } from '@/composables/usePlayerBackground'

const playerStore = usePlayerStore()
const musicStore = useMusicStore()
const router = useRouter()
// 模板不能直接访问 window(Vue 模板全局白名单不含 window),此处提取供模板 v-if 使用
const hasCoverAPI = !!window.electronAPI?.selectCover

// 返回:历史栈为空时(如直接进入播放页)回退到主页,避免"返回键失灵"
function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/home')
}

const lyricsPanel = ref(null)
const splitLyricsEl = ref(null)

// 播放列表面板
const showQueuePanel = ref(false)
// 音效面板(播放页)
const showEqPanel = ref(false)
function toggleQueuePanel() {
  showQueuePanel.value = !showQueuePanel.value
}
// 综合空白关闭:任何面板打开时挂全局监听,点击面板/触发按钮之外区域全部关闭
let _pvPanelWatch = null
function setupPvPanelsClickOutside() {
  if (_pvPanelWatch) return
  _pvPanelWatch = watch(
    [showQueuePanel, showEqPanel, showBgPanel, showColorPanel, () => playerStore.volPanelOpen, showRatePanel, showPitchPanel, showSpecPanel, showModePanel],
    (vs) => {
      if (vs.some(Boolean)) document.addEventListener('click', onPvPanelDocClick)
      else document.removeEventListener('click', onPvPanelDocClick)
    }
  )
}
function onPvPanelDocClick(e) {
  // 音量滑杆拖动中(pointer 移出弹层)不关闭
  if (consumeVolDragging()) return
  // 面板内 / 触发按钮上点击不关闭
  if (e.target.closest('.queue-panel, .eq-panel, .bg-panel, .color-panel, .format-panel, .vol-pop, .rate-panel, .pitch-panel, .mode-panel') ||
      e.target.closest('.ctrl-btn--small, .vol-btn, .icon-btn, .ctrl-mode, [data-queue-toggle], .ls-btn')) return
  showQueuePanel.value = false
  showEqPanel.value = false
  showBgPanel.value = false
  showColorPanel.value = false
  showFormatPanel.value = false
  playerStore.volPanelOpen = false
  showPitchPanel.value = false
  showRatePanel.value = false
  showSpecPanel.value = false
  showModePanel.value = false
  showFormatPanel.value = false // 此前漏了它(点外部关闭里有,Esc 没有)
}
const activeTab = ref('cover')


// 频谱可视化:状态与绘制全部由 useSpectrum 提供(原内联实现约 290 行)
const { spectrumCanvas, spectrumRingCanvas, specMode, SPEC_MODES, SPEC_DENSITIES, barCount, setSpecDensity } = useSpectrum(playerStore, activeTab)
const coverUrl = computed(() => playerStore.currentSong?.coverUrl || null)
// 封面加载态:仅用于骨架动效。加载完成后必须停止 shimmer ——
// 原先 animation: shimmer infinite 是无条件挂在 <img> 上的,图片渲染出来之后
// 动画仍在空跑(img 自身的背景渐变已完全被图片覆盖,看不见但一直在耗)。
const coverLoaded = ref(false)
watch(coverUrl, () => { coverLoaded.value = false }, { immediate: true })

// 首次进入播放页的封面时序(常驻一行日志):渲染端的 console 会进主进程日志,
// 所以用户那台下次出现"封面要等一会"时,直接读数字就能定位,不用再靠猜。
let _enterAt = null
onMounted(() => { _enterAt = performance.now() })
watch(coverLoaded, (v) => {
  if (!v || _enterAt === null) return
  const loadMs = Math.round(performance.now() - _enterAt)
  requestAnimationFrame(() => {
    const el = document.querySelector('.album-art img, .disc-cover img')
    const shown = el ? Math.round(el.getBoundingClientRect().width) : 0
    console.info(`[封面时序] 进播放页→封面 load ${loadMs}ms,首帧 ${Math.round(performance.now() - _enterAt)}ms · 显示 ${shown}px · 窗口 ${window.innerWidth}×${window.innerHeight}`)
    _enterAt = null
  })
})

/**
 * 封面/歌名的入场动画**只在切歌时播**,首次进入播放页不播。
 * 三个容器都带 `:key="...currentSong.path"`,切歌时是重新创建,所以动画本来每首歌都会重播 ——
 * 但首次挂载也吃到了它:元素从 opacity:0 开始、0.5s 才到 1,看起来就是"封面还没渲染完"。
 * 这个动画的意图(commit d420f79)本来就是切歌过渡,不是进场。
 */
const switchAnim = ref(false)
let _songSeenOnce = false
watch(() => playerStore.currentSong?.path, (p) => {
  if (!p) return
  if (!_songSeenOnce) { _songSeenOnce = true; return }
  switchAnim.value = true
})
function onSwitchAnimEnd() { switchAnim.value = false }
// 封面预加载:切歌时保持旧封面,新图 new Image() 就绪后才切换 --cover-bg(消除切歌白帧)
const bgCover = ref(null)

// 背景系统:状态/预设/封面取主色/bgStyle 全部由 usePlayerBackground 提供(原内联实现约 148 行)
const {
  bgPresets, bgMode, bgBrightness, bgColor, bgGradient, bgImageUrl, bgStyle,
  setBgMode, setBgBrightness, setBgColor, setBgGradient, importBgImage, clearBgImage
} = usePlayerBackground({ coverUrl, bgCover })
const hdCoverUrl = ref(null)
let _coverSeq = 0
watch(coverUrl, (url) => {
  const seq = ++_coverSeq
  if (!url) { bgCover.value = null; hdCoverUrl.value = null; return }
  // 预加载原图:就绪即切换(失败也切,避免永久空白)
  const img = new Image()
  img.onload = () => { if (seq === _coverSeq) bgCover.value = url }
  img.onerror = () => { if (seq === _coverSeq) bgCover.value = url }
  img.src = url
  // 高清封面异步升级:hd 图也预加载成功后替换背景(失败保持原图,避免空白)
  hdCoverUrl.value = null
  if (!window.electronAPI?.getHdCover) return
  window.electronAPI.getHdCover(url).then(r => {
    if (seq !== _coverSeq || !r?.ok || !r.url) return
    const hd = new Image()
    hd.onload = () => { if (seq === _coverSeq) { hdCoverUrl.value = r.url; bgCover.value = r.url } }
    hd.onerror = () => { /* hd 加载失败保持原图 */ }
    hd.src = r.url
  }).catch(() => { /* 网络失败保持原图 */ })
}, { immediate: true })
// 播放页信息行:比特率 · 采样率(数据来自 metadata 解析)
// 音质信息:结构化返回(便于分别着色),悬停用 title 给完整说明
const currentSongInfo = computed(() => {
  const s = playerStore.currentSong
  if (!s) return []
  const parts = []
  if (s.format) parts.push({ text: s.format, tone: 'fmt' })
  if (s.bitDepth) parts.push({ text: s.bitDepth + 'bit', tone: '' })
  if (s.sampleRate) parts.push({ text: (s.sampleRate / 1000).toFixed(1) + 'kHz', tone: '' })
  if (s.bitrate) parts.push({ text: s.bitrate + 'kbps', tone: '' })
  if (bpmCache.value[s.path || '']) parts.push({ text: bpmCache.value[s.path] + 'BPM', tone: '' })
  if (playerStore.isTranscoded) parts.push({ text: '转码播放', tone: 'warn' })
  if (playerStore.replayGainEnabled && playerStore.currentGainDb) {
    const db = playerStore.currentGainDb
    parts.push({ text: '响度' + (db > 0 ? '+' : '') + db + 'dB', tone: 'ok' })
  }
  if (playerStore.eqSettings.enabled) parts.push({ text: '音效', tone: 'ok' })
  return parts
})

// 悬停展开的完整说明:把"为什么显示转码/位深为什么没有"这类疑问一次说清
const infoTitle = computed(() => {
  const s = playerStore.currentSong
  if (!s) return ''
  const lines = [
    `格式:${s.format || '未知'}${playerStore.isTranscoded ? '(经 ffmpeg 转码为 FLAC 播放,Chromium 无法原生解码该格式)' : ''}`,
    s.bitrate ? `码率:${s.bitrate} kbps` : '',
    s.sampleRate ? `采样率:${s.sampleRate} Hz` : '',
    s.bitDepth ? `位深:${s.bitDepth} bit` : '位深:该文件未提供(有损格式没有位深)',
    s.duration ? `时长:${playerStore.formatTime(s.duration)}` : '',
    playerStore.replayGainEnabled
      ? `响度均衡:${playerStore.currentGainDb ? (playerStore.currentGainDb > 0 ? '提升 ' : '衰减 ') + playerStore.currentGainDb + ' dB' : '已开启,本曲无需调整'}`
      : '响度均衡:未开启',
    playerStore.eqSettings.enabled ? '音效:已开启' : '音效:未开启'
  ]
  return lines.filter(Boolean).join('\n')
})

// 按钮固定宽度、只显示 A / B 两个字母的点亮状态 —— 时间戳不放进按钮:
// 生效时若写「1:23-1:47」会把按钮撑到旁边图标键的两倍宽,进度条被挤小、整行还会跳动。
// 精确区间交给 tooltip 与进度条上的色带(那里才是它该出现的位置)。
const abTitle = computed(() => {
  const st = playerStore.abState
  const t = (x) => playerStore.formatTime(x)
  if (st === 'off') return 'A-B 循环:点击把当前位置设为起点 A'
  if (st === 'setting') return `A-B 循环:已设 A = ${t(playerStore.abStart)},再点一次把当前位置设为终点 B(再点一次可取消)`
  return `A-B 循环中:${t(playerStore.abStart)} - ${t(playerStore.abEnd)}(点击取消)`
})
// BPM 缓存(按歌曲路径;分析一次永久记住,切歌即时显示)
const bpmCache = ref((() => { try { return JSON.parse(localStorage.getItem('soundflow_bpm_cache') || '{}') } catch { return {} } })())
function _saveBpmCache() { try { localStorage.setItem('soundflow_bpm_cache', JSON.stringify(bpmCache.value)) } catch {} }
let _bpmPendingSet = new Set() // 并发分析中歌曲路径集合,避免互相清空 pending 导致重复分析
// 当前是否用的是"自定义封面":select-cover 把用户选的图复制成 covers/pl_<时间戳>.<ext>,
// 曲库只记 URL,所以按这个命名判断即可 —— 对"功能上线前就换过封面"的老数据同样成立,
// 不需要在曲库里新增字段(两套来源就看不出差别了)。
const hasCustomCover = computed(() => isCustomCoverUrl(playerStore.currentSong?.coverUrl))

// 恢复原封面:原封面文件是 <hash>-768.jpg,与自定义封面互不覆盖,因此它一直在磁盘上
async function restoreCover() {
  const s = playerStore.currentSong
  if (!s || !s.path || !window.electronAPI?.restoreCover) return
  const r = await window.electronAPI.restoreCover(s.path).catch(() => null)
  if (!r || !r.ok || !r.url) {
    window.$toast?.('没能找回原封面(可能已被"清封面缓存"清掉,重新扫描该目录会再次生成)', 'warning', 5000)
    return
  }
  s.coverUrl = r.url
  // 一次性重试图标复位:否则下次封面加载失败时不再自动重试
  delete s._coverRetried
  musicStore.updateSong(s.path, { coverUrl: r.url })
  window.$toast?.(r.reextracted ? '已按音频标签里的原封面恢复' : '已恢复原封面', 'success')
}

// 更换当前歌曲封面(信息区 hover 操作)
async function swapCover() {
  const s = playerStore.currentSong
  if (!s || !s.path || !window.electronAPI?.selectCover) return
  const coverPath = await window.electronAPI.selectCover().catch(() => null)
  if (!coverPath) return
  const url = coverPath.startsWith('file://') ? coverPath : 'file:///' + coverPath.replace(/\\/g, '/')
  s.coverUrl = url
  musicStore.updateSong(s.path, { coverUrl: url })
}

async function ensureBpm() {
  const s = playerStore.currentSong
  if (!s || !s.path) return
  if (bpmCache.value[s.path] || _bpmPendingSet.has(s.path)) return
  _bpmPendingSet.add(s.path)
  try {
    if (window.electronAPI && window.electronAPI.analyzeBpm) {
      const r = await window.electronAPI.analyzeBpm(s.path)
      if (r && r.ok && r.bpm) {
        bpmCache.value = { ...bpmCache.value, [s.path]: r.bpm }
        _saveBpmCache()
      }
    }
  } catch {}
  _bpmPendingSet.delete(s.path)
}

// 封面容灾:封面文件丢失时重新生成
function onCoverError() {
  const song = playerStore.currentSong
  if (!song || song._coverRetried || !window.electronAPI) return
  song._coverRetried = true
  window.electronAPI.getCover(song.path)
    .then(url => { if (url) song.coverUrl = url })
    .catch(() => {})
}
// ===== 播放页背景设置(封面 / 纯色 / 渐变,持久化) =====

const playModeLabel = computed(() => {
  const cur = playerStore.PLAY_MODES.find(m => m.key === playerStore.playMode)
  return cur ? t(cur.labelKey) : ''
})
const currentModeIcon = computed(() => {
  const cur = playerStore.PLAY_MODES.find(m => m.key === playerStore.playMode)
  return cur ? cur.icon : 'modeList'
})

// 歌词来源标签的文案:来源名(本地 / LRCLIB / 网易云 / 自动)后面接"歌词"读得通,
// 但状态类那几个本身就是一句话 —— 直接拼会变成"音源异常歌词""网络不可用歌词"。
// 三态分类(未找到 / 网络不可用 / 音源异常)是 2026-09-26 加上的,这里配上读得通的文案与配色。
const LYRIC_ORIGIN_TEXT = {
  未找到: '未找到歌词',
  获取超时: '获取超时,歌词没取到',
  网络不可用: '网络不可用,歌词没取到',
  音源异常: '音源异常,歌词没取到',
  加载失败: '歌词加载失败'
}
const lyricOriginText = computed(() => {
  const o = playerStore.lyricOrigin
  if (!o) return ''
  return LYRIC_ORIGIN_TEXT[o] || `${o}歌词`
})
const lyricOriginIsProblem = computed(() => Object.prototype.hasOwnProperty.call(LYRIC_ORIGIN_TEXT, playerStore.lyricOrigin))

/**
 * 两处歌词面的滚动定位共用同一套"按容器查当前行"的写法。
 * 此前各用一份 ref 回调(`activeLyricEl` / `splitActiveEl`)由模板赋值,两份实现还长得不一样,
 * 于是"进去时定位到当前行"只在歌词页做了 —— 分栏进播放页停在歌词开头。
 */
function activeLineElIn(container) {
  return container ? container.querySelector('.lyric-line.active') : null
}

// 滚动歌词到当前播放行(近距离平滑/远距离直接跳)
function scrollToActiveLyric() {
  nextTick(() => {
    const panel = lyricsPanel.value
    const el = activeLineElIn(panel)
    if (!panel || !el) return
    const pr = panel.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const dist = (r.top + r.height / 2) - (pr.top + pr.height / 2)
    el.scrollIntoView({ behavior: Math.abs(dist) <= 200 ? 'smooth' : 'auto', block: 'center' })
  })
}

// 分栏那份:容器不是滚动元素本身,自己算 scrollTop(近距离平滑)
function scrollSplitToActive(smooth = false) {
  nextTick(() => {
    const wrap = splitLyricsEl.value
    const list = wrap && wrap.querySelector('.lyrics-scroll')
    const el = activeLineElIn(list)
    if (!list || !el) return
    const lr = el.getBoundingClientRect()
    const sr = list.getBoundingClientRect()
    const delta = lr.top - sr.top - sr.height / 2 + lr.height / 2
    if (smooth && Math.abs(delta) <= 200) list.scrollTo({ top: list.scrollTop + delta, behavior: 'smooth' })
    else list.scrollTop += delta
  })
}

/** 当前可见的那个歌词面定位到当前行 */
function locateActiveLyric(smooth = false) {
  if (activeTab.value === 'lyric') scrollToActiveLyric()
  else if (useSplit.value) scrollSplitToActive(smooth)
}

// 切歌时自动滚动歌词:近距离平滑、远距离直接跳(避免播放中每句 smooth 的持续合成开销)
watch(() => playerStore.currentLyricIndex, () => {
  scrollToActiveLyric()
  scrollSplitToActive()
})

// 进入歌词 tab / 进入分栏时都定位到当前播放行(播放一会后再进不再停在开头)
watch(activeTab, (v) => {
  if (v === 'lyric') scrollToActiveLyric()
  else locateActiveLyric(true)
})
// 分栏相关的两个 watcher 见文件下方 useSplit 声明之后 ——
// watch 注册时会立刻求值源,写在这里会撞 useSplit 的暂时性死区(播放页整页白屏)

// 切歌时自动切换到封面模式
watch(() => playerStore.currentSong, () => {
  activeTab.value = 'cover'
  ensureBpm() // 切歌自动分析新歌 BPM(有缓存即时显示)
})

// 音量控制(数字输入/滑杆拖动/滚轮调音量)由 useVolumeControl 统一提供
const { volInput, setVolume, volDragStart, volDragEnd, consumeVolDragging, confirmVolInput, wheelVolume } = useVolumeControl(playerStore)
// 播放页滚轮调音量:歌词区滚轮用于滚动歌词,不拦截(其余排除由 wheelVolume 内部处理)
function onViewWheel(e) { wheelVolume(e, ['.lyrics-scroll, .lyrics-content, .lyric-mode']) }
function toggleMini() { window.electronAPI?.toggleMiniWindow() }

// 点击歌词跳转到对应播放进度
function seekToLine(line) {
  if (line && Number.isFinite(line.time)) {
    playerStore.seek(line.time)
  }
}

// 导入本地歌词文件(复制 .lrc 到歌曲同目录)
async function importLocalLyric() {
  const song = playerStore.currentSong
  if (!song || !window.electronAPI) return
  searchLyricMsg.value = ''
  try {
    const lrcPath = await window.electronAPI.selectLyricFile()
    if (!lrcPath) return
    const r = await window.electronAPI.bindLyricFile(song.path, lrcPath)
    if (r && r.ok) {
      searchLyricMsg.value = '✅ 已导入本地歌词'
      window.$toast?.('已导入本地歌词 ✓', 'success')
      await playerStore.loadLyrics(song)
    } else {
      const err = (r && r.error) || '请检查文件权限'
      searchLyricMsg.value = '⚠️ 歌词导入失败:' + err
      window.$toast?.('歌词导入失败:' + err, 'error')
    }
  } catch (e) {
    searchLyricMsg.value = '导入出错'
  }
}

// 歌词来源的选择入口只在设置页;播放页只在"在线搜索歌词并下载"时按当前偏好带上来源
// 工具栏是否显示:歌词页恒显示;封面页仅在分栏时显示(分栏那一屏右半边就是歌词)
const showLyricToolbar = computed(() => activeTab.value !== 'cover' || useSplit.value)
// 歌词右侧栏收起状态(持久化)
const lyricSidebarCollapsed = ref(localStorage.getItem('soundflow_lyric_sidebar') === '1')
// 工具栏展开/收起:持久化从模板内联语句收进函数(此前写在 @click 里,与读取点分散在两处)
function toggleLyricSidebar() {
  lyricSidebarCollapsed.value = !lyricSidebarCollapsed.value
  try { localStorage.setItem('soundflow_lyric_sidebar', lyricSidebarCollapsed.value ? '1' : '0') } catch {}
}
// 工具栏键盘导航:上下键在按钮间移动(role="toolbar" 的配套行为)
function onSidebarKeydown(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const btns = [...e.currentTarget.querySelectorAll('.ls-btn')]
  const i = btns.indexOf(document.activeElement)
  if (i < 0) return
  e.preventDefault()
  const next = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length
  btns[next].focus()
}
function toggleLyricEffect() {
  lyricEffect.value = !lyricEffect.value
  try { localStorage.setItem('soundflow_lyric_effect', lyricEffect.value ? '1' : '0') } catch {}
  playerStore.refreshLyricWindowStyle() // 桌面歌词窗也吃这套样式,改完立刻重推
}

// 歌词字号(可调,localStorage 持久化)
const lyricFontSize = ref(parseInt(localStorage.getItem('soundflow_lyric_font_size')) || 18)

// 歌词排版弹出面板(字号 / 行距 / 偏移)
const showFormatPanel = ref(false)
// 曲目预览卡(悬停"上一曲/下一曲"时显示;内容由 TrackHint 按 store 状态给出)
const showNextHint = ref(false)
const showPrevHint = ref(false) // 与下一首同一张卡:上一首也做悬停预览
// 偏移滑杆节流:拖动期间每 150ms 落盘一次,松手的 @change 再补一次精确值。
// playerStore.setLyricUserOffset 每次都会序列化整份「按曲偏移表」并同步写 localStorage,
// 直接绑在 @input 上等于拖动过程中每秒上百次同步写。
let _offsetSlideTs = 0
function slideLyricOffset(v) {
  const now = Date.now()
  if (now - _offsetSlideTs < 150) return
  _offsetSlideTs = now
  playerStore.setLyricUserOffset(v)
}
// 滑杆用的绝对设定(与行距同样的夹取方式)
function setLyricFont(v) {
  lyricFontSize.value = Math.max(12, Math.min(36, Math.round(v) || 18))
  localStorage.setItem('soundflow_lyric_font_size', String(lyricFontSize.value))
  playerStore.refreshLyricWindowStyle()
}

// 歌词行距(1.3-2.4,持久化)
const lyricLineGap = ref(parseFloat(localStorage.getItem('soundflow_lyric_gap')) || 1.6)
function setLyricGap(v) {
  lyricLineGap.value = Math.max(1.3, Math.min(2.4, Math.round((Number(v) || 1.6) * 100) / 100))
  localStorage.setItem('soundflow_lyric_gap', String(lyricLineGap.value))
  playerStore.refreshLyricWindowStyle()
}

// 歌词颜色(8 色色板,持久化)
const lyricColorOptions = [
  { name: '白色', value: '#ffffff' },
  { name: '蓝色', value: '#5aa8ff' },
  { name: '粉色', value: '#ff8fb3' },
  { name: '绿色', value: '#5dd87a' },
  { name: '金色', value: '#f7c948' },
  { name: '紫色', value: '#c29bff' },
  { name: '青色', value: '#4fd8d8' },
  { name: '红色', value: '#ff7a7a' }
]
import { getSetting } from '../config/defaults.js'
import Icon from '@/components/icons/Icon.vue'
import { confirmDialog } from '@/composables/useConfirm'
const lyricColor = ref(getSetting('soundflow_lyric_color'))
function setLyricColor(v) {
  lyricColor.value = v
  localStorage.setItem('soundflow_lyric_color', v)
  playerStore.refreshLyricWindowStyle()
  try { window.$toast?.('歌词颜色已更新', 'success') } catch {}
}
const lyricIsCustom = computed(() => !lyricColorOptions.some(c => c.value === lyricColor.value))
// 背景纯色自定义取色:当前色不在预设色板里时,给"自定义"色点加选中描边
const bgColorIsCustom = computed(() => !bgPresets.color.some(c => c.value === bgColor.value))
const bgColorPickrEl = ref(null)
const lyricColorPickrEl = ref(null)
let _bgPickr = null
function openBgColorPicker() {
  const btn = bgColorPickrEl.value
  if (!btn || typeof window.Pickr === 'undefined') return
  if (_bgPickr) { _bgPickr.destroy(); _bgPickr = null }
  _bgPickr = window.Pickr.create({
    el: btn,
    theme: 'nano',
    default: bgColor.value,
    swatches: bgPresets.color.map(c => c.value),
    components: { preview: true, opacity: false, hue: true, interaction: { hex: true, input: true, save: true } }
  })
  _bgPickr.on('change', (color) => { if (color) setBgColor(color.toHEXA().toString()) })
  _bgPickr.on('save', (color) => { if (color) { setBgColor(color.toHEXA().toString()); _bgPickr?.hide() } })
}

let _lyricPickr = null
function openLyricPicker() {
  // 用 ref 而不是 querySelector:页面里有两个 .color-dot-custom(背景面板那个 DOM 更靠前),
  // 背景面板开着时 querySelector 会取到背景那个点,取色器就挂错地方了
  const btn = lyricColorPickrEl.value
  if (!btn || typeof window.Pickr === 'undefined') return
  if (_lyricPickr) { _lyricPickr.destroy(); _lyricPickr = null }
  _lyricPickr = window.Pickr.create({
    el: btn,
    theme: 'nano',
    default: lyricColor.value,
    swatches: lyricColorOptions.map(c => c.value),
    components: { preview: true, opacity: false, hue: true, interaction: { hex: true, input: true, save: true } }
  })
  _lyricPickr.on('change', (color) => { if (color) setLyricColor(color.toHEXA().toString()) })
  _lyricPickr.on('save', (color) => { if (color) { setLyricColor(color.toHEXA().toString()); _lyricPickr?.hide() } })
}
const showBgPanel = ref(false)
const showColorPanel = ref(false)
const lyricEffect = ref((() => { try { return localStorage.getItem('soundflow_lyric_effect') === '1' } catch { return false } })())
// 歌词行颜色/阴影的规则在 src/utils/lyricStyle.js —— **与桌面歌词窗共用同一份**:
// 桌面窗有个"与播放界面一致"的显示方式,它是独立页面(拿不到 ESM),所以由应用侧把
// 算好的每行 color/shadow 随载荷下发(buildLyricWindowPayload)。规则别在这里再写一套。
function lyricLineColor(idx) {
  return lineColor({ color: lyricColor.value, effect: lyricEffect.value, idx, currentIdx: playerStore.currentLyricIndex })
}
function lyricLineShadow(idx) {
  return lineShadow({ color: lyricColor.value, effect: lyricEffect.value, idx, currentIdx: playerStore.currentLyricIndex })
}
// 音量弹层开关已改为 playerStore.volPanelOpen(播放栏/播放页共享互斥)
const showPitchPanel = ref(false) // 变调面板默认收起
const showSpecPanel = ref(false) // 频谱设置面板默认收起
// 大屏左右分栏:手动设置优先(localStorage),未设置按窗口 >900px 自动
const useSplit = ref((() => {
  try {
    const m = localStorage.getItem('soundflow_pv_split')
    if (m === 'on') return true
    if (m === 'off') return false
  } catch {}
  return window.innerWidth > 900
})())
function toggleSplit() {
  useSplit.value = !useSplit.value
  try { localStorage.setItem('soundflow_pv_split', useSplit.value ? 'on' : 'off') } catch {}
}
function onSplitResize() {
  // 未手动设置时才跟随窗口宽度
  try {
    const m = localStorage.getItem('soundflow_pv_split')
    if (m === 'on' || m === 'off') return
  } catch {}
  useSplit.value = window.innerWidth > 900
}

// 分栏是本次新补的能力:打开分栏、或歌词刚加载出来时,同样要定位到当前行。
// 注意这两个必须写在 useSplit 声明**之后** —— watch 注册时会立刻求值一次源,
// 放前面会撞暂时性死区(ReferenceError: Cannot access ... before initialization,整页白屏)。
watch(useSplit, (on) => { if (on && activeTab.value === 'cover') scrollSplitToActive(true) })
watch(() => playerStore.lyrics, () => locateActiveLyric())
const showRatePanel = ref(false) // 倍速面板默认收起
const showModePanel = ref(false) // 播放模式选择菜单
function pickPlayMode(key) {
  playerStore.setPlayMode(key)
  showModePanel.value = false
}
// 音调/速度数字输入(Enter/失焦确认)
const pitchInput = ref(playerStore.pitch)
const rateInput = ref(playerStore.playbackRate)
watch(() => playerStore.pitch, (v) => { pitchInput.value = v })
watch(() => playerStore.playbackRate, (v) => { rateInput.value = v })
function confirmPitchInput() {
  let v = Math.round(Number(pitchInput.value))
  if (isNaN(v)) v = playerStore.pitch
  v = Math.max(-12, Math.min(12, v))
  pitchInput.value = v
  playerStore.setPitch(v)
}
function confirmRateInput() {
  let v = Number(rateInput.value)
  if (isNaN(v) || v <= 0) v = playerStore.playbackRate
  v = Math.max(0.25, Math.min(3, v))
  rateInput.value = v
  playerStore.setPlaybackRate(v)
}

// Esc 关闭播放页所有面板
function onPvEsc() {
  showQueuePanel.value = false
  showEqPanel.value = false
  showBgPanel.value = false
  showColorPanel.value = false
  playerStore.volPanelOpen = false
  showPitchPanel.value = false
  showRatePanel.value = false
  showSpecPanel.value = false
  showModePanel.value = false
  showFormatPanel.value = false // 此前漏了它(点外部关闭里有,Esc 没有)
}
// 双击封面全屏切换;ESC 退出全屏
function toggleFullscreen() {
  try { if (window.electronAPI?.toggleFullscreen) window.electronAPI.toggleFullscreen() } catch {}
}
// 快进/快退 ±N 秒
function jumpSeek(delta) {
  const t = Math.max(0, Math.min(playerStore.duration || 0, (playerStore.currentTime || 0) + delta))
  playerStore.seek(t)
}
// 播放页滚轮调音量(歌词区滚轮用于滚动歌词,不拦截;可滚动区域让出给默认滚动)
// 实现见上方 onViewWheel → wheelVolume(useVolumeControl)
function onPvKeydown(e) {
  // 输入框内不拦截方向键(避免影响光标移动)
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'Escape') {
    try { if (window.electronAPI?.exitFullscreen) window.electronAPI.exitFullscreen() } catch {}
  } else if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey) {
    // ←/→ 快退/快进 10 秒(主流播放器全屏/播放页常用)
    jumpSeek(10); e.preventDefault()
  } else if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey) {
    jumpSeek(-10); e.preventDefault()
  }
}
onMounted(() => {
  setupPvPanelsClickOutside()
  document.addEventListener('soundflow:esc', onPvEsc)
  window.addEventListener('resize', onSplitResize)
  document.addEventListener('keydown', onPvKeydown)
  // 进入播放页分析当前歌 BPM(有缓存秒出)。**推迟到空闲**:首次进播放页时这一步要起
  // ffmpeg 子进程解码 60s PCM,并在主进程里跑几百万次循环采样 —— 与封面上屏同刻抢 CPU,
  // 而 BPM 数字晚几百毫秒出现没有任何代价。
  if (window.requestIdleCallback) window.requestIdleCallback(() => ensureBpm(), { timeout: 3000 })
  else setTimeout(ensureBpm, 800)
  // 进入播放页时若歌词尚未加载(未播放过/切源后),补一次读取;本地歌词删除/外部修改后也能立即反映
  if (playerStore.currentSong && playerStore.lyrics.length === 0) {
    playerStore.loadLyrics(playerStore.currentSong)
  }
})
onUnmounted(() => {
  document.removeEventListener('click', onPvPanelDocClick)
  document.removeEventListener('soundflow:esc', onPvEsc)
  window.removeEventListener('resize', onSplitResize)
  document.removeEventListener('keydown', onPvKeydown)
})

// 歌词对齐(居中/左,持久化)
const lyricAlign = ref(localStorage.getItem('soundflow_lyric_align') || 'center')
function toggleLyricAlign() {
  lyricAlign.value = lyricAlign.value === 'center' ? 'left' : 'center'
  playerStore.refreshLyricWindowStyle()
  localStorage.setItem('soundflow_lyric_align', lyricAlign.value)
}

// 歌词模式:整行 / 逐字高亮(持久化)
const lyricMode = ref(localStorage.getItem('soundflow_lyric_mode') || 'line')

// 桌面歌词窗也能改这几项(它的右键菜单是同一个真源的另一个入口):
// store 落盘后会自增 lyricSettingRev,这里据此重读,界面与应用侧设置才同步。
watch(() => playerStore.lyricSettingRev, () => {
  try {
    lyricFontSize.value = parseInt(localStorage.getItem('soundflow_lyric_font_size')) || lyricFontSize.value
    lyricLineGap.value = parseFloat(localStorage.getItem('soundflow_lyric_gap')) || lyricLineGap.value
    lyricAlign.value = localStorage.getItem('soundflow_lyric_align') || lyricAlign.value
    lyricEffect.value = localStorage.getItem('soundflow_lyric_effect') === '1'
    lyricMode.value = localStorage.getItem('soundflow_lyric_mode') || lyricMode.value
  } catch {}
})
function toggleLyricMode() {
  lyricMode.value = lyricMode.value === 'word' ? 'line' : 'word'
  playerStore.refreshLyricWindowStyle()
  localStorage.setItem('soundflow_lyric_mode', lyricMode.value)
}
// 当前逐字索引(基于 currentTime 与行内时间戳;标准LRC按均分时间近似)
const currentWordIdx = computed(() => {
  if (!playerStore.isPlaying) return -1
  const line = playerStore.lyrics[playerStore.currentLyricIndex]
  if (!line) return -1
  const segs = lyricWordSegments(line)
  if (!segs.length) return -1
  // 用共享的 lyricClock(已扣除歌词偏移)而不是原始 currentTime:
  // 否则调整偏移后行高亮会跟着变、逐字高亮却不变,两者错位
  return wordIndexAt(segs, playerStore.lyricClock)
})
// 文本切分与权重计时已收敛到 @/utils/lyricTiming(可单测;原实现内联在本组件内)

// 歌词偏移显示:用户微调值(正值=歌词延后),点一下即归零
const lyricOffsetLabel = computed(() => {
  const ms = playerStore.lyricUserOffsetMs || 0
  if (!ms) return '±0'
  return `${ms > 0 ? '+' : ''}${(ms / 1000).toFixed(1)}s`
})
// 逐字渲染段:有增强时间戳直接用;无则由 utils/lyricTiming 按权重推算
// (标点不计时、拉丁词按长度加权、CJK 逐字,详见该模块)
// 缓存键必须带开始时间:只用行文本的话,重复出现的副歌行会共用第一次算出的时间戳
const _wordSegCache = new Map()
function lyricWordSegments(line) {
  if (!line) return []
  if (line.words && line.words.length) return line.words
  const curIdx = playerStore.currentLyricIndex
  const next = playerStore.lyrics[curIdx + 1]
  const key = `${line.time}|${line.text}`
  if (_wordSegCache.has(key)) return _wordSegCache.get(key)
  const out = buildWordSegments(line, next ? next.time : null)
  if (_wordSegCache.size > 300) _wordSegCache.clear()
  _wordSegCache.set(key, out)
  return out
}

// 读取歌词文件夹配置(在线搜索下载优先存这里,避免散落在歌曲同目录)
function lyricFoldersForSave() {
  try { return JSON.parse(localStorage.getItem('soundflow_lyric_folders') || '[]') } catch { return [] }
}

// 删除当前歌曲的本地歌词文件(绕开资源管理器删除问题,精确匹配不误删)
async function deleteLocalLyric() {
  const song = playerStore.currentSong
  if (!song || !window.electronAPI) return
  if (!(await confirmDialog({ message: '确定删除这首歌的本地歌词文件？', detail: '删除后播放时将改用在线歌词', confirmText: '删除', danger: true }))) return
  let folders = []
  try { folders = JSON.parse(localStorage.getItem('soundflow_lyric_folders') || '[]') } catch {}
  const r = await window.electronAPI.deleteLyricFile(song.path, folders)
  if (r && r.ok) {
    window.$toast?.('本地歌词已删除 ✓ 已切换到在线歌词', 'success')
    playerStore.loadLyrics(song)
  } else {
    window.$toast?.('删除失败:' + ((r && r.error) || '请检查文件权限'), 'error')
  }
}

// 说明:歌词来源的切换入口只在设置页「歌词」区(与「在线歌词」开关、翻译服务、批量下载同处)。
// 播放页工具栏原先也有一组同样的 4 个按钮,写的是同一个 key、两份几乎相同的切换逻辑 —— 已删;
// 这里只在"在线搜索歌词并下载"时按当前偏好带上来源。

// 在线搜索并下载歌词到本地(LRCLIB → 网易云)
const searchingLyric = ref(false)
const searchLyricMsg = ref('')

async function searchLyric() {
  const song = playerStore.currentSong
  if (!song || searchingLyric.value || !window.electronAPI) return
  searchingLyric.value = true
  searchLyricMsg.value = ''
  try {
    const res = await window.electronAPI.searchOnlineLyric({
      title: song.title,
      artist: song.artist || '',
      duration: song.duration || 0,
      source: playerStore.lyricSourcePref()
    })
    if (res?.lyrics) {
      // 源自带译文轨时并成"一行双语"再写盘(与用户手里那些双语 .lrc 同格式);
      // 下次加载会被拆分逻辑还原成"主行原文 + 一行译文"
      const saveText = mergeTranslatedLRC(res.lyrics, res.translation || '')
      const saved = await window.electronAPI.saveLyricFile(song.path, saveText, lyricFoldersForSave())
      if (saved?.ok) {
        searchLyricMsg.value = '✅ 已保存到歌曲同目录'
        await playerStore.loadLyrics(song)
      } else {
        searchLyricMsg.value = '⚠️ 获取成功但保存失败'
      }
    } else {
      // 手动搜索也要说清"为什么没有":超时/网络不通/音源异常各自该做的事不一样,
      // 笼统一句"未找到"会让人以为是自己这首歌太冷门
      const why = res && res.error
      searchLyricMsg.value = why === 'timeout' ? '⏱ 获取超时,稍后重试或切换歌词来源'
        : why === 'network' ? '⚠️ 网络不可用,请检查连接'
          : why === 'source' ? '⚠️ 音源返回异常,切换歌词来源试试'
            : '未找到歌词,可切换歌词来源(LRCLIB/QQ音乐/网易云)或稍后重试'
    }
  } catch (e) {
    searchLyricMsg.value = '搜索失败,请检查网络'
  } finally {
    searchingLyric.value = false
  }
}
</script>

<style scoped>
.player-view {
  width: 100%; height: 100%;
  background: var(--bg-primary);
  position: relative; overflow: hidden;
}

.player-overlay {
  position: absolute; inset: 0;
  /* 主题化遮罩:深浅主题各自适配(深色主题更深,浅色主题适度),保留封面本色呈现 */
  background:
    radial-gradient(90% 45% at 50% 100%, var(--player-overlay-strong, rgba(0, 0, 0, 0.22)), transparent 70%),
    linear-gradient(180deg, var(--player-overlay-soft, rgba(0,0,0,0.15)) 0%, rgba(0,0,0,0.06) 45%, var(--player-overlay-strong, rgba(0,0,0,0.40)) 100%);
  display: flex; flex-direction: column;
}
/* 封面背景:伪元素高清提亮(不模糊,封面原图铺底;单层 filter,避开 Electron 叠加渲染异常);z-index 0 垫底 */
.player-view[data-bg="cover"]::before {
  content: "";
  position: absolute; inset: 0;
  background-image: var(--cover-bg);
  background-size: cover;
  background-position: center;
  filter: brightness(var(--bg-bright, 110%)) saturate(1.15);
  z-index: 0;
  pointer-events: none;
}
.bg-bright-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.bg-bright-label { font-size: 11px; color: rgba(255,255,255,0.6); flex-shrink: 0; }
.bg-bright-slider { flex: 1; min-width: 0; }
.bg-bright-val { font-size: 11px; color: rgba(255,255,255,0.7); width: 38px; text-align: right; }
.player-overlay.overlay-theme { background: rgba(0,0,0,0.15); }

/* 顶部栏 */
.player-topbar {
  position: relative;
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px; flex-shrink: 0;
}

.back-btn {
  display: flex; align-items: center; gap: 6px;
  color: rgba(255,255,255,0.85); font-size: var(--font-size-base);
  background: rgba(0,0,0,0.25); border-radius: 8px; padding: 6px 10px;
  transition: all 0.15s;
}
.back-btn:hover { color: white; background: rgba(0,0,0,0.4); }
.back-btn svg { width: 20px; height: 20px; }

.tab-switcher { display: flex; gap: 4px; background: rgba(0,0,0,0.3); border-radius: 8px; padding: 3px; }
.tab-btn {
  padding: 6px 20px; border-radius: 6px; font-size: var(--font-size-sm);
  color: rgba(255,255,255,0.78); transition: all 0.2s;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
}
.tab-btn.active { background: rgba(255,255,255,0.28); color: white; font-weight: 600; }
.tab-btn:hover { color: white; }

.topbar-right { display: flex; gap: 8px; }
.icon-btn {
  width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; color: rgba(255,255,255,0.85);
  background: rgba(0,0,0,0.25); transition: all 0.15s;
}
.icon-btn:hover { color: #fff; background: rgba(0,0,0,0.4); }
.icon-btn.active { color: #fff; background: var(--color-primary); }
.icon-btn svg { width: 18px; height: 18px; }

/* ===== 封面模式 ===== */
.cover-mode {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  /* 圆盘与间距随窗口高度自适应,防止小窗口组件被挤出变形 */
  /* 盘径要同时受**高度预算**约束:封面台是 1.5×盘径,而顶栏+频谱+控制栏+歌名信息
     大约吃掉 460px —— 不扣这一项时,1280×800 就会超支并在纵向压到频谱条上(实测重叠 17px,
     960×600 时 78px,封面顶部还会跑到顶栏下面) */
  --disc: clamp(130px, min(32vh, 30vw, calc((100vh - 460px) / 1.5)), 300px);
  --gap: clamp(8px, 2.6vh, 32px);
  gap: var(--gap);
}
/* 大屏分栏:左封面右歌词并排(YesPlayMusic 布局) */
.cover-mode.split { flex-direction: row; justify-content: center; align-items: center; gap: 48px; padding: 0 8vw; }
.cover-mode.split .cover-left { display: flex; flex-direction: column; align-items: center; gap: var(--gap); flex-shrink: 0; }
.split-lyrics { flex: 1; max-width: 560px; min-width: 0; height: 100%; overflow: hidden; }
.split-lyrics .lyrics-scroll { height: 100%; overflow-y: auto; padding: 8px 64px 8px 12px; } /* 右侧 64px 给浮动工具栏让位 */
/* 分栏:方形封面 + 半露旋转 CD(文档可视化风格) */
.album-stage { position: relative; width: calc(var(--disc) * 1.5); height: calc(var(--disc) * 1.5); }
.album-art {
  width: 70%; aspect-ratio: 1; border-radius: 12px; overflow: hidden;
  box-shadow: 0 18px 48px rgba(0,0,0,0.5); position: absolute; left: 0; top: 15%;
  z-index: 2; /* 封面在上,盖住 CD 左半 */
}
.album-art img, .cd-half img { width: 100%; height: 100%; object-fit: cover; }
/* 骨架动效只在加载期间挂着:加载完成后类被移除,避免动画在图片之下永远空跑 */
.album-art img.img-loading, .cd-half img.img-loading, .disc-cover img.img-loading {
  background: linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-active) 50%, var(--bg-hover) 75%);
  background-size: 800px 100%;
  animation: shimmer 1.4s infinite linear;
}
.album-art .cover-placeholder, .cd-half .cover-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 48px; background: rgba(255,255,255,0.08); }
/* cd-wrap 承担垂直定位(与 spin 动画 transform 隔离),CD 只做旋转 */
.cd-wrap {
  position: absolute; left: 36%; top: 50%; transform: translateY(-50%);
  width: 62%; aspect-ratio: 1; z-index: 1; pointer-events: none;
}
.cd-half {
  width: 100%; height: 100%; border-radius: 50%; overflow: hidden;
  box-shadow: 0 10px 30px rgba(0,0,0,0.45); position: relative;
}
/* CD 多层渐变:中心透明孔 → 内壁阴影 → 透明 → 外圈反光(底层透出) */
.cd-half::after {
  content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background:
    radial-gradient(circle at 50% 50%,
      transparent 0 10%,                                /* 中心孔:底层透出 */
      rgba(0,0,0,0.92) 10% 12%,                          /* 内壁暗环 */
      rgba(255,255,255,0.5) 12% 13.5%,                   /* 内壁高光细环 */
      transparent 13.5% 40%,                             /* 透明带:碟面透出 */
      rgba(255,255,255,0.14) 40% 46%,                    /* 碟面内圈微光 */
      transparent 46% 88%,                               /* 主透明区 */
      rgba(255,255,255,0.7) 88% 92%,                     /* 外圈反光 */
      rgba(0,0,0,0.45) 92% 96%,                          /* 外缘暗边 */
      rgba(255,255,255,0.9) 96% 100%                     /* 边缘亮线 */
    );
}
.cd-half::before {
  content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  background:
    radial-gradient(circle at 30% 28%, rgba(255,255,255,0.5) 0%, transparent 38%),
    radial-gradient(circle at 72% 74%, rgba(255,255,255,0.22) 0%, transparent 40%),
    linear-gradient(135deg, rgba(255,255,255,0.28) 0%, transparent 45%);
  mix-blend-mode: screen;
}
.cd-half.spinning { animation: spin 24s linear infinite; }
/* 分栏歌词:当前行只保留"加粗"这一层强调,颜色/发光/胶囊底都交给共用规则 ——
   用户设的歌词颜色走行内 style,胶囊底受 ✨ 特效开关控制。
   此前这条写着 `color: #FFD700 !important` 且 `background:none`,把当前行锁成金色、
   还干掉了胶囊高亮,于是在这一面"歌词颜色"设置看起来完全没生效。 */
.split-lyrics .lyric-line.active { font-weight: 700; }

.disc-area { position: relative; display: flex; flex-direction: column; align-items: center; }

.disc-ring {
  width: var(--disc, 300px); height: var(--disc, 300px); border-radius: 50%;
  border: 6px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  position: relative;
  box-shadow: 0 10px 44px rgba(0,0,0,0.35);
  will-change: transform; /* 独立合成层,避免旋转触发整页重排 */
}
/* 唱片主色柔光晕(切歌/播放时氛围感) */
.disc-ring::after {
  content: '';
  position: absolute; inset: -14px; border-radius: 50%;
  background: radial-gradient(closest-side, transparent 86%, var(--color-primary-alpha) 100%);
  pointer-events: none;
}
@keyframes disc-in {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
.song-meta { text-align: center; }
/* 入场动画只在切歌时播(见 switchAnim):首次进入播放页不该淡入 */
.song-meta.switch-anim { animation: meta-in 0.4s ease; }
@keyframes meta-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* tab 切换过渡(已移除,保留样式无引用) */
.disc-ring.spinning { animation: spin 20s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.disc-cover {
  width: calc(var(--disc, 300px) - 30px); height: calc(var(--disc, 300px) - 30px); border-radius: 50%; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,0.4);
}
/* 同上:入场淡入只在切歌时播 */
.disc-cover.switch-anim { animation: disc-in 0.5s ease; }
.disc-cover img { width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder {
  width: 100%; height: 100%; background: rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center; font-size: 64px;
}

.song-meta { text-align: center; }
.song-title { font-size: clamp(20px, 3.8vh, 30px); font-weight: 700; color: white; margin-bottom: 10px; letter-spacing: 0.5px; text-shadow: 0 2px 18px rgba(0,0,0,0.35); }
.song-artist { font-size: var(--font-size-lg); color: #c6d0e0; transition: color 0.2s; }
.song-artist:hover { color: var(--color-primary, #1677E6); }
.song-album { font-size: var(--font-size-base); color: #8a94a8; margin-top: 6px; transition: color 0.2s; }
.song-album:hover { color: #aab4c8; }

/* 信息区 hover 操作:更换封面 */
.cover-swap {
  margin-top: 12px;
  padding: 5px 12px;
  font-size: 12px;
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 14px;
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.85);
  cursor: pointer;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.25s, transform 0.25s, background 0.2s;
}
.cover-actions { display: flex; gap: 8px; margin-top: 12px; }
.cover-actions .cover-swap { margin-top: 0; }
.song-meta:hover .cover-actions .cover-swap { opacity: 1; transform: translateY(0); }
.cover-swap:hover { background: rgba(255,255,255,0.18); }
/* 音质信息行:结构化片段 + 语义着色(转码=警示色,响度与音效生效=成功色) */
.song-info { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px 8px; font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 6px; letter-spacing: 0.3px; }
.si-part { white-space: nowrap; }
.si-part.fmt { color: var(--color-primary); font-weight: 600; letter-spacing: 0.3px; }
.si-part.warn { color: var(--color-warning); }
.si-part.ok { color: var(--color-success); }
.song-info:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: 4px; }

/* A-B 循环按钮:定宽,内容固定为 A / B 两个字母,避免生效时按钮变宽挤动进度条 */
.ab-btn {
  width: 44px; height: 26px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 3px;
  border-radius: 999px; font-size: 11px; font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.08);
  transition: color var(--transition-fast), background var(--transition-fast);
}
.ab-btn:hover { background: rgba(255, 255, 255, 0.16); }
.ab-btn--setting { background: rgba(255, 255, 255, 0.16); }
.ab-btn--active { background: var(--color-primary); color: #fff; }

/* 曲目预览的定位容器(卡片本体样式在 TrackHint 组件内) */
.hint-wrap { position: relative; display: flex; }
/* 设定进度直接落在字母上:只设了 A → A 亮;B 也设了 → 同时亮 */
.ab-dot { opacity: 0.45; transition: opacity var(--transition-fast), color var(--transition-fast); }
.ab-dot.on { opacity: 1; color: #fff; }
.ab-btn--active .ab-dot { opacity: 1; }

/* ===== 歌词模式 ===== */
.lyric-mode {
  flex: 1; display: flex; overflow: hidden;
}

.lyric-left {
  --disc-sm: clamp(110px, 20vh, 180px);
  width: clamp(190px, 24vw, 280px); flex-shrink: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: clamp(8px, 2vh, 20px);
  padding: 20px;
}

.disc-small {
  width: var(--disc-sm, 180px); height: var(--disc-sm, 180px); border-radius: 50%;
  border: 4px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.disc-small.spinning { animation: spin 20s linear infinite; }

.disc-cover-small {
  width: calc(var(--disc-sm, 180px) - 20px); height: calc(var(--disc-sm, 180px) - 20px); border-radius: 50%; overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.disc-cover-small img { width: 100%; height: 100%; object-fit: cover; }
.spectrum-bar { display: block; margin: 14px auto 0; max-width: 520px; width: 100%; height: 80px; opacity: 0.9; pointer-events: none; }
/* 矮窗(≤700px 高)下频谱条减半:它固定吃 94px,而垂直预算本来就紧张 */
@media (max-height: 700px) {
  .spectrum-bar { height: 44px; margin-top: 8px; }
}
/* 矮窗(≤640px 高)下把封面区的次要行收起来:专辑名/音质/封面按钮加起来约 60px,
   不收的话封面块底边会压到频谱条上(960×600 实测重叠 54×17) */
@media (max-height: 640px) {
  .song-album, .song-info { display: none; }
  .cover-actions { display: none; }
}
/* 圆形环绕频谱:相对 disc-area(唱片)居中,圆心=唱片圆心 */
.spectrum-ring { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: calc(var(--disc) * 1.5); height: calc(var(--disc) * 1.5); pointer-events: none; z-index: 4; opacity: 0.85; }

.song-meta-small { text-align: center; }
.song-title-sm { font-size: 18px; font-weight: 600; color: white; margin-bottom: 4px; }
.song-artist-sm { font-size: var(--font-size-base); color: #aab6cc; }

.lyric-right {
  position: relative;
  flex: 1; display: flex; align-items: center; overflow: hidden;
}

.lyrics-scroll {
  position: relative;
  width: 100%; height: 100%;
  overflow-y: auto; padding: 0 64px 0 40px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
}

/* height:100% 是必须的,不能只写 min-height:占位块用的是 height:30%/40%,而百分比高度**只认
   父元素的 height**(min-height 不建立确定高度)→ 此前容器没高度、占位恒为 0,首行贴顶、
   最后一句永远无法居中(实测 offsetHeight=0)。固定高度不影响滚动:行是它的子元素,
   溢出部分照样计入滚动区。 */
.lyrics-content { text-align: center; height: 100%; }

.lyrics-empty {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  color: rgba(255,255,255,0.35); font-size: 18px;
}
.lyric-loading-tip {
  display: flex; align-items: center; gap: 10px;
  font-size: 14px; color: rgba(255,255,255,0.45);
}
.es-icon { display: inline-flex; color: var(--empty-icon, var(--text-tertiary)); }
.empty-hint { font-size: var(--font-size-sm); color: rgba(255,255,255,0.25); line-height: 1.6; }
.search-lyric-btn { margin-top: 4px; padding: 8px 18px; background: var(--color-primary); color: #fff; border-radius: 20px; font-size: var(--font-size-sm); transition: all 0.2s; }
.search-lyric-btn.local { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.85); }
.search-lyric-btn.local:hover { background: rgba(255,255,255,0.2); }
.search-lyric-btn:hover { background: var(--color-primary-light); transform: scale(1.03); }
.search-lyric-btn:disabled { opacity: 0.6; cursor: wait; transform: none; }
.search-lyric-msg { font-size: var(--font-size-xs); color: rgba(255,255,255,0.5); }

.lyric-line {
  padding: 10px 0; font-size: 18px;
  color: rgba(255,255,255,0.3);
  transition: all 0.4s ease;
  line-height: 1.6;
  cursor: pointer;
  border-radius: 6px;
  text-align: center;
  position: relative;
}
/* 行时间戳:默认隐藏,hover 显示;当前行常显(QQ 音乐风) */
.lyric-line.left { text-align: left; }
/* 远离当前句:明度层次(不透明,避免 opacity/blur 合成层糊字) */
.lyric-line.near { opacity: 1; filter: none; }
.lyric-line.far { opacity: 1; filter: none; }
/* 工具栏分组:此前 14 个按钮挤成一列没有分区,看不出哪些是「来源」哪些是「字号」 */
.ls-group-label {
  font-size: 10px; color: var(--panel-text-tertiary, rgba(255,255,255,0.45));
  letter-spacing: 0.5px; padding: 2px 0 1px; text-align: center; user-select: none;
}
.ls-sep { height: 1px; width: 22px; margin: 3px auto; background: rgba(255,255,255,0.14); }
.ls-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

.lyric-line:hover {
  color: rgba(255,255,255,0.75);
  background: rgba(255,255,255,0.06);
}
.ls-del-btn { margin-left: 6px; padding: 0 4px; font-size: 12px; cursor: pointer; opacity: 0.7; border: none; background: none; }
.ls-del-btn:hover { opacity: 1; }
.lyric-origin-tag {
  position: absolute;
  top: 6px;
  right: 12px;
  z-index: 5;
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  background: rgba(255,255,255,0.08);
  padding: 2px 8px;
  border-radius: 10px;
}
/* 状态类标签(未找到 / 网络不可用 / 音源异常):这是一句提示,不是"来源",给一点警示色 */
.lyric-origin-tag.is-problem {
  color: var(--color-warning, #e8b339);
  background: rgba(232, 179, 57, 0.12);
}
/* 工具栏挂载层:必须脱离 flex 流(.player-overlay 是 flex column,
   作为普通 flex 项参与布局会挤动封面/歌词区)——整层绝对定位只做定位容器,
   自身不接收鼠标事件,由内部工具栏按需接收 */
.lyric-toolbar-layer {
  position: absolute;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}
.lyric-toolbar-layer > * { pointer-events: auto; }

.lyric-source-switch {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(0,0,0,0.35);
  border-radius: 12px;
  transition: all 0.2s ease;
}
/* 收起态:缩成小竖条,只显示展开按钮 */
.lyric-source-switch.collapsed {
  gap: 0;
  background: rgba(0,0,0,0.22);
}
.lyric-source-switch.collapsed .ls-btn:not(.ls-collapse) { display: none; }
.ls-collapse { font-size: 13px; }
.lyric-source-switch {
  padding: 4px 3px;
}
.ls-btn {
  width: 46px;
  padding: 6px 0;
  font-size: 11px;
  color: rgba(255,255,255,0.5);  border-radius: 8px;
  text-align: center;
  transition: all 0.2s;
}
.ls-btn:hover { color: #fff; }
.ls-btn.active { background: var(--color-primary); color: #fff; }
/* 偏移按钮:标签形如 +0.3s / ±0,比 A− 略宽且不允许换行 */
.ls-offset { width: 52px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ls-offset.active { font-weight: 600; }

/* 背景设置面板 */
.bg-panel {
  position: absolute;
  top: 48px;
  right: 12px;
  z-index: 40;
  width: 240px;
  padding: 14px;
  background: rgba(16, 18, 26, 0.95);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0,0,0,0.5);
}
.panel-title { font-size: var(--font-size-sm); font-weight: 600; color: rgba(255,255,255,0.9); margin-bottom: 10px; }
.bg-mode-btns { display: flex; gap: 6px; margin-bottom: 10px; }
.bg-mode-btns button {
  flex: 1; padding: 5px 0; font-size: var(--font-size-xs); color: rgba(255,255,255,0.55);
  background: rgba(255,255,255,0.07); border-radius: 6px; transition: all 0.15s;
}
.bg-mode-btns button:hover { color: #fff; }
.bg-mode-btns button.active { background: var(--color-primary); color: #fff; }
.color-row { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 0; }

/* 歌词排版面板:与色板同构(深色浮层,从竖条左侧弹出) */
.format-panel {
  position: absolute;
  top: 50%;
  right: 58px;
  transform: translateY(-50%);
  z-index: 999;
  width: 232px;
  padding: 12px 12px 10px;
  background: rgba(16, 18, 26, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
  /* 自带深色底就自带一整套面板 token(与其它浮层一致):今天这里没有输入框,
     但漏掉这组 token 的代价是"将来一加输入框就白字压白底",而守卫无法判断有没有输入框 */
  color: #eaf2ff;
  --text-primary: #eaf2ff;
  --text-secondary: #aab6cc;
  --text-tertiary: #7c879c;
  --bg-hover: rgba(255,255,255,0.08);
  --bg-active: rgba(255,255,255,0.12);
  --border-color: rgba(255,255,255,0.12);
  --input-bg: rgba(255,255,255,0.08);
  --input-border: rgba(255,255,255,0.14);
  --input-focus-ring: rgba(120,170,255,0.22);
  --bg-secondary: rgba(255,255,255,0.12);
}
.fp-title {
  font-size: 11px; color: rgba(255,255,255,0.7); text-align: center;
  border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 8px;
}
.fp-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.fp-label { width: 30px; flex-shrink: 0; font-size: 11px; color: rgba(255,255,255,0.62); }
.fp-slider { flex: 1; min-width: 0; }
.fp-val {
  width: 46px; flex-shrink: 0; text-align: right;
  font-size: 11px; color: var(--color-primary); font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.fp-sub { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 2px; }
.fp-mini {
  min-width: 30px; height: 22px; padding: 0 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; color: rgba(255,255,255,0.78);
  background: rgba(255,255,255,0.08); border-radius: 6px;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.fp-mini:hover:not(:disabled) { background: var(--color-primary); color: #fff; }
.fp-mini:disabled { opacity: 0.4; cursor: not-allowed; }
.fp-hint { margin-top: 6px; font-size: 10px; color: rgba(255,255,255,0.4); text-align: center; }

/* 歌词颜色面板 */
.color-panel {
  position: absolute;
  top: 50%;
  right: 58px;
  transform: translateY(-50%);
  z-index: 999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 8px;
  background: rgba(16, 18, 26, 0.97);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0,0,0,0.5);
}
.color-panel-title {
  font-size: 11px; color: rgba(255,255,255,0.7); text-align: center;
  border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 2px;
}
.color-dot {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid transparent; transition: all 0.15s; flex-shrink: 0;
}
.color-dot.active { border-color: #fff; transform: scale(1.15); }
/* 自定义取色按钮:渐变描边 + 取色器图标 */
.color-dot-custom {
  position: relative;
  background-image: conic-gradient(#f55, #fa5, #ff5, #5f5, #5ff, #55f, #f5f, #f55) !important;
  border-color: rgba(255,255,255,0.35);
}
.color-dot-custom::after {
  /* 自定义取色按钮:此前用 🎨 emoji 当图标(由系统字体渲染,大小/基线不受控)——
     改为纯 CSS 的白色描边小圆点表示"可自定义",与色板其它色点视觉一致 */
  content: ""; position: absolute; inset: 0;
  margin: auto; width: 6px; height: 6px;
  border-radius: 50%; background: #fff;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.25);
}
.bg-image-actions { display: flex; flex-direction: column; gap: 8px; }
.bg-import-btn { padding: 8px 0; font-size: var(--font-size-xs); color: #fff; background: var(--color-primary); border-radius: 6px; transition: all 0.15s; }
.bg-import-btn:hover { background: var(--color-primary-light); }
.bg-clear-btn { padding: 6px 0; font-size: var(--font-size-xs); color: rgba(255,255,255,0.6); background: rgba(255,255,255,0.08); border-radius: 6px; }
.bg-clear-btn:hover { color: #fff; background: rgba(255,255,255,0.15); }
.bg-image-preview { height: 80px; border-radius: 8px; background-size: cover; background-position: center; border: 1px solid rgba(255,255,255,0.1); }
.lyric-line.active {
  color: white; font-size: 22px; font-weight: 600;
  text-shadow: 0 0 20px rgba(22,119,230,0.5);
}
/* 当前行胶囊高亮背景条(受 ✨ 歌词特效开关控制) */
.lyrics-content:not(.no-lyric-effect) .lyric-line.active {
  background: linear-gradient(90deg, transparent, var(--color-primary-alpha, rgba(22,119,230,0.16)), transparent);
  box-shadow: inset 0 0 0 1px rgba(22,119,230,0.18);
}

/* ===== 底部控制栏 ===== */
/* 面板(EQ/队列)以自己的定位祖先为锚:这里设成 relative,
   面板用 bottom: calc(100% + 8px) 就能"永远贴在控制栏上沿" ——
   此前面板锚在整窗口 + 写死 bottom:76px,而控制栏实际高 136px(窄窗换行后 176px),
   实测每档分辨率都在盖播放键,960×600 时把播放键盖掉 56×56(整个按钮) */
.player-controls {
  position: relative;
  flex-shrink: 0; padding: 14px 40px 20px;
  display: flex; flex-direction: column; gap: 12px;
  /* 毛玻璃:半透明底 + 背景模糊,层次更分明 */
  background: rgba(8, 14, 26, 0.32);
  backdrop-filter: blur(14px) saturate(1.25);
  -webkit-backdrop-filter: blur(14px) saturate(1.25);
  border-radius: 18px 18px 0 0;
  border-top: 1px solid rgba(255,255,255,0.08);
}

.controls-row {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  min-height: 56px;
}
.controls-group {
  /* 整组**真正居中**:两侧工具组按钮数不同、宽度不等,靠 margin:auto 居中会偏 -12~-24px。
     绝对定中之后位置与两侧内容无关,窗口怎么改都不会漂。 */
  position: absolute; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; justify-content: center; gap: 10px;
  /* 按钮全部绝对定位:播放键居中,上一曲/下一曲对称贴靠,模式/倍速两端 */
}
.tools-group-left { display: flex; align-items: center; gap: 12px; margin-right: auto; }
.tools-group {
  /* 流式靠右(播放组居中,左工具组靠左) */
  display: flex; align-items: center; gap: 12px; margin-left: auto;
}
.ctrl-btn.active { color: var(--color-primary); }
.ctrl-btn--small { width: var(--ctrl-btn-sm, 34px); height: var(--ctrl-btn-sm, 34px); font-size: var(--font-size-sm); }
.ctrl-btn--small svg { width: 20px; height: 20px; }
.volume-control {
  position: relative; display: flex; align-items: center;
}
.vol-pop {
  position: absolute; bottom: calc(100% + 12px); left: 50%; margin-left: -32px;
  padding: 10px 8px;

  z-index: 60;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.vol-fade-enter-active, .vol-fade-leave-active { transition: opacity 0.18s; }
.vol-fade-enter-from, .vol-fade-leave-to { opacity: 0; }

.queue-slide-enter-active, .queue-slide-leave-active { transition: opacity 0.22s, transform 0.22s; }
.queue-slide-enter-from, .queue-slide-leave-to { opacity: 0; transform: translateY(12px); }

.ctrl-btn {
  width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: rgba(255,255,255,0.8); font-size: 20px;
  transition: all 0.15s;
}
.ctrl-btn:hover { color: white; background: rgba(255,255,255,0.1); box-shadow: 0 0 12px var(--color-primary-alpha); }
.ctrl-btn svg { width: 24px; height: 24px; }

.ctrl-btn--play {
  width: 56px; height: 56px;
  background: var(--color-primary); color: white !important;
  box-shadow: 0 4px 18px var(--color-primary-alpha, rgba(0,0,0,0.4));
}
.ctrl-btn--play:hover { background: var(--color-primary-light); transform: scale(1.05); box-shadow: 0 6px 24px var(--color-primary-alpha); }
.ctrl-btn--play svg { width: 28px; height: 28px; }
.ctrl-btn--play .player-spin { width: 28px; height: 28px; animation: pv-spin 0.8s linear infinite; }
@keyframes pv-spin { to { transform: rotate(360deg); } }
/* flex 流式对称:播放键居中,上/下曲贴靠,模式/倍速/变调对称两端 */
.ctrl-prev, .ctrl-next, .ctrl-mode { position: static; }

.progress-row { display: flex; align-items: center; gap: 12px; padding: 0 32px; }
.seek-jump {
  width: 34px; height: 34px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  color: rgba(255,255,255,0.7);
  transition: all 0.15s;
}
.seek-jump:hover { color: white; background: rgba(255,255,255,0.1); }
.seek-jump svg { width: 18px; height: 18px; }
.time {
  font-size: var(--font-size-xs); color: rgba(255,255,255,0.45);
  min-width: 42px; text-align: center; font-variant-numeric: tabular-nums;
}

.progress-bar { flex: 1; height: 20px; display: flex; align-items: center; cursor: pointer; }
.progress-track { width: 100%; height: 4px; background: rgba(255,255,255,0.12); border-radius: 2px; position: relative; }
.progress-fill { height: 100%; background: var(--color-primary); border-radius: 2px; }
.progress-thumb {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: 14px; height: 14px; background: white; border-radius: 50%;
  opacity: 0; transition: opacity 0.15s; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}
.progress-bar:hover .progress-thumb { opacity: 1; }
.progress-bar:hover .progress-track { height: 6px; }

.vol-btn {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: rgba(255,255,255,0.5);
}
.vol-btn:hover { color: white; }
.vol-btn svg { width: 18px; height: 18px; }

/* .vol-slider 已收敛到 src/styles/controls.css(替换废弃的 slider-vertical) */

/* 变调控件 */
.pitch-control { position: relative; display: flex; align-items: center; }
.pitch-badge {
  position: absolute; top: -4px; right: -6px;
  font-size: 9px; font-weight: 700;
  background: var(--color-primary, #4096ff); color: #fff;
  border-radius: 8px; padding: 0 4px; line-height: 14px;
}
.pitch-panel {
  position: absolute; bottom: calc(100% + 10px); left: 50%; margin-left: -140px;
  padding: 10px 14px; width: 280px; z-index: 60;
}
.pitch-header { display: flex; justify-content: space-between; align-items: center; font-size: var(--font-size-sm, 13px); margin-bottom: 6px; }
.pitch-value { color: #6ec6ff; font-weight: 700; }
.pitch-panel input[type="range"],
.rate-panel input[type="range"] {
  width: 100%; -webkit-appearance: none; appearance: none; height: 6px;
  background: var(--border-color, rgba(120,130,150,0.5)); border-radius: 3px; outline: none; cursor: pointer;
}
.pitch-panel input[type="range"]::-webkit-slider-runnable-track,
.rate-panel input[type="range"]::-webkit-slider-runnable-track {
  height: 6px; border-radius: 3px;
  background: var(--border-color, rgba(120,130,150,0.5));
}
.pitch-panel input[type="range"]::-webkit-slider-thumb,
.rate-panel input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px; margin-top: -4px;
  background: var(--color-primary, #4096ff);
  border: 2px solid #fff; border-radius: 50%; cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.35);
}
.pitch-presets { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.pitch-preset {
  flex: 1; min-width: 42px; padding: 3px 0; font-size: var(--font-size-sm, 12px);
  border: 1px solid var(--border-color, rgba(255,255,255,0.18)); border-radius: 6px;
  background: transparent; color: rgba(255,255,255,0.78); cursor: pointer; transition: all 0.15s;
}
.pitch-preset:hover { border-color: #6ec6ff; color: #6ec6ff; }
.pitch-preset.active {
  background: var(--color-primary, #4096ff); color: #fff; border-color: var(--color-primary, #4096ff);
  box-shadow: 0 0 0 1px var(--color-primary, #4096ff);
}
.voice-presets { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.voice-preset {
  flex: 1 1 30%; min-width: 58px; padding: 4px 0; font-size: var(--font-size-sm, 11px);
  border: 1px dashed var(--border-color, rgba(255,255,255,0.25)); border-radius: 6px;
  background: transparent; color: rgba(255,255,255,0.65); cursor: pointer; transition: all 0.15s;
}
.voice-preset:hover { border-color: #6ec6ff; color: #6ec6ff; }
.voice-preset.active { background: var(--color-primary, #4096ff); color: #fff; border-color: var(--color-primary, #4096ff); box-shadow: 0 0 0 1px var(--color-primary, #4096ff); }
.rate-control { position: relative; display: flex; align-items: center; }
/* 倍速/变调回到 flex 流内(不再绝对定位):
   此前用 `left: calc(50% + 102px/152px)` 锚在**窗口**中心,而播放组因为两侧工具组宽度不等
   本来就偏向一边 —— 结果是跨 1200px 断点时按钮间距 17px↔32px 跳变、播放键中心也偏离真中心。
   现在:前面放一个与"倍速+变调+两个间距"等宽的占位块,整组仍然居中,且跟着按钮尺寸一起变。 */
.ctrl-sym-spacer { flex: 0 0 auto; width: var(--ctrl-btn-sm, 34px); height: 1px; }
/* 宽度 = 一个小按钮:把"播放键左右两侧占位"配平的解恰好是它 ——
   左边(占位+模式+上曲+两个间距) 与 右边(下曲+倍速+变调+三个间距) 相等时播放键居中 */

.rate-panel {
  position: absolute; bottom: calc(100% + 10px); left: 50%; margin-left: -140px;
  padding: 10px 14px; width: 280px; z-index: 60;
  color: rgba(255,255,255,0.85);
}
/* 播放模式选择菜单:与倍速面板同一套底色与抬升高度(宽度按内容) */
.mode-control { position: relative; display: flex; }
.mode-panel {
  position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%);
  padding: 6px; width: 168px; z-index: 60;
  display: flex; flex-direction: column; gap: 2px;
}
.mode-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 10px; border-radius: 7px; border: none; background: none; cursor: pointer;
  font-size: var(--font-size-sm, 13px); color: var(--text-primary); text-align: left;
  transition: background 0.15s;
}
.mode-item span { flex: 1; }
.mode-item:hover { background: var(--bg-hover, rgba(255,255,255,0.1)); }
.mode-item.active { color: var(--color-primary, #4096ff); font-weight: 600; }
.mode-check { flex: none; }
.rate-presets { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
.rate-preset {
  flex: 1; min-width: 38px; padding: 3px 0; font-size: var(--font-size-sm, 11px);
  border: 1px solid var(--border-color, rgba(255,255,255,0.18)); border-radius: 6px;
  background: transparent; color: rgba(255,255,255,0.78); cursor: pointer; transition: all 0.15s;
}
.rate-preset:hover { border-color: #6ec6ff; color: #6ec6ff; }
.rate-preset.active { background: var(--color-primary, #4096ff); color: #fff; border-color: var(--color-primary, #4096ff); }
.pitch-scale { display: flex; justify-content: space-between; font-size: 10px; color: #aab6cc; margin-top: 2px; padding: 0 2px; }
.pitch-value--active { color: #fff; background: var(--color-primary, #4096ff); border-radius: 4px; padding: 0 6px; }
.pitch-row { display: flex; align-items: center; gap: 6px; margin: 6px 0 2px; }
.pitch-row-label { min-width: 28px; font-size: var(--font-size-xs, 12px); color: rgba(255,255,255,0.72); }
.pitch-row-val { min-width: 34px; text-align: center; font-size: 11px; color: #6ec6ff; font-weight: 700; font-variant-numeric: tabular-nums; }
.pitch-row input[type="number"] { width: 54px; }
.pitch-slider { width: 100%; margin: 2px 0; }
.pitch-val-big { text-align: center; font-size: 22px; font-weight: 800; color: var(--color-primary, #4096ff); font-variant-numeric: tabular-nums; line-height: 1.3; margin: 2px 0 4px; }
.pitch-val-big--active { text-shadow: 0 0 12px var(--color-primary-alpha, rgba(64,150,255,0.6)); }
.pitch-scale { display: flex; justify-content: space-between; font-size: 10px; color: #aab6cc; margin: 2px 2px 8px; }
.pitch-input-group { display: flex; align-items: center; gap: 4px; }
.pitch-input-group span { font-size: 11px; color: #aab6cc; }
.pitch-presets { display: flex; gap: 4px; flex-wrap: wrap; margin: 2px 0 8px; }
.pitch-preset {
  flex: 1; min-width: 34px; padding: 3px 0; font-size: var(--font-size-sm, 11px);
  border: 1px solid var(--border-color, rgba(255,255,255,0.18)); border-radius: 6px;
  background: transparent; color: rgba(255,255,255,0.85); cursor: pointer; transition: all 0.15s;
}
.pitch-preset:hover { border-color: var(--color-primary, #4096ff); color: var(--color-primary, #4096ff); }
.pitch-preset.active { background: var(--color-primary, #4096ff); color: #fff; border-color: var(--color-primary, #4096ff); }
.pitch-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.pitch-reset {
  font-size: var(--font-size-sm, 12px); padding: 3px 14px;
  border: 1px solid var(--border-color, rgba(255,255,255,0.15)); border-radius: 6px;
  background: transparent; color: rgba(255,255,255,0.78); cursor: pointer;
}
.pitch-reset:hover { background: rgba(255,255,255,0.1); }

/* 频谱设置面板 */
.spec-control { position: relative; display: flex; align-items: center; }
.spec-panel {
  position: absolute; bottom: calc(100% + 10px); right: 0;
  background: rgba(20,28,50,0.95); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px; padding: 10px 14px; width: 210px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35); z-index: 60; color: rgba(255,255,255,0.85);
}
.spec-group { margin: 6px 0 2px; }
.spec-group-note { font-size: 11px; line-height: 1.5; color: var(--text-tertiary); padding: 2px 2px 0; }
.spec-group-name { font-size: 11px; color: #aab6cc; margin-bottom: 4px; }
.spec-opts { display: flex; gap: 4px; }
.spec-opts .pitch-preset { flex: 1; min-width: 0; }

/* 窗口变窄:压缩工具组,避免与中间控制按钮重叠 */
@media (max-width: 1200px) {
  .tools-group, .tools-group-left { gap: 8px; }
  .tools-group .ctrl-btn--small, .tools-group-left .ctrl-btn--small { width: 30px; height: 30px; }
  /* 控制组的小按钮(倍速/变调)也跟着缩,占位块靠这个变量自动跟随 */
  .controls-group { --ctrl-btn-sm: 30px; }
  .controls-group .ctrl-btn--small { width: 30px; height: 30px; }
  .player-controls { padding: 12px 20px 16px; }
}
@media (max-width: 960px) {
  /* 工具组流式 + 控制行允许换行,两排不重叠 */
  .tools-group, .tools-group-left { gap: 6px; }
  .tools-group .ctrl-btn--small, .tools-group-left .ctrl-btn--small { width: 28px; height: 28px; }
  .controls-row { flex-wrap: wrap; row-gap: 8px; min-height: 0; }
  .controls-group { position: static; transform: none; order: -1; width: 100%; justify-content: center; flex-wrap: wrap; gap: 8px; }
  .controls-group .ctrl-btn--small, .controls-group .ctrl-btn { margin: 0 !important; }
}

/* ===== 播放页浮层面板统一:固定深色浮层(浮于深色播放背景上,16 主题可读)=====
   软件渲染(默认):近不透明深色,可读不卡;
   硬件加速(body.hw-accel):半透明毛玻璃,透出封面更精致 */
.queue-panel, .eq-panel, .pitch-panel, .rate-panel, .spec-panel, .vol-pop,
.bg-panel, .color-panel {
  background: rgba(16, 18, 26, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
  color: #eaf2ff;
  --text-primary: #eaf2ff;
  --text-secondary: #aab6cc;
  --text-tertiary: #7c879c;
  --bg-hover: rgba(255, 255, 255, 0.08);
  --bg-active: rgba(255, 255, 255, 0.12);
  --border-color: rgba(255, 255, 255, 0.12);
  /* 输入框 token 必须一起重映射:这些面板不管什么主题都强制深色、文字是近白,
     而浅色主题下 --input-bg 是近白 —— 漏掉这一组会让音量/倍速/音调的数值输入框
     白字压白底(实测对比度约 1.03:1,完全看不见)。--bg-secondary 是输入框聚焦态用的。 */
  --input-bg: rgba(255, 255, 255, 0.08);
  --input-border: rgba(255, 255, 255, 0.14);
  --input-focus-ring: rgba(120, 170, 255, 0.22);
  --bg-secondary: rgba(255, 255, 255, 0.12);
}
body.hw-accel .queue-panel,
body.hw-accel .eq-panel,
body.hw-accel .pitch-panel,
body.hw-accel .rate-panel,
body.hw-accel .spec-panel,
body.hw-accel .vol-pop,
body.hw-accel .bg-panel,
body.hw-accel .color-panel {
  background: rgba(16, 18, 26, 0.62) !important;
  backdrop-filter: blur(22px) saturate(1.2);
  -webkit-backdrop-filter: blur(22px) saturate(1.2);
}
</style>
