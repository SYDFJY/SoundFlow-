<template>
  <div class="player-view" :style="bgStyle">
    <div class="player-overlay" :class="{ 'overlay-theme': bgMode === 'theme' }">
      <!-- 顶部栏 -->
      <div class="player-topbar">
        <button class="back-btn" @click="goBack">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span>{{ t('playerView.back') }}</span>
        </button>
        <div class="tab-switcher">
          <button class="tab-btn" :class="{ active: activeTab === 'cover' }" @click="activeTab = 'cover'">{{ t('playerView.cover') }}</button>
          <button class="tab-btn" :class="{ active: activeTab === 'lyric' }" @click="activeTab = 'lyric'">{{ t('playerView.lyrics') }}</button>
        </div>
        <div class="topbar-right">
          <button class="icon-btn" @click="showBgPanel = !showBgPanel" title="播放页背景设置">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          </button>
        </div>
        <!-- 背景设置面板 -->
        <div v-if="showBgPanel" class="bg-panel" @click.stop>
          <div class="panel-title">播放页背景</div>
          <div class="bg-mode-btns">
            <button :class="{ active: bgMode === 'theme' }" @click="setBgMode('theme')">主题</button>
            <button :class="{ active: bgMode === 'cover' }" @click="setBgMode('cover')">{{ t('playerView.cover') }}</button>
            <button :class="{ active: bgMode === 'auto' }" @click="setBgMode('auto')">主色</button>
            <button :class="{ active: bgMode === 'color' }" @click="setBgMode('color')">纯色</button>
            <button :class="{ active: bgMode === 'gradient' }" @click="setBgMode('gradient')">渐变</button>
            <button :class="{ active: bgMode === 'image' }" @click="setBgMode('image')">图片</button>
          </div>
          <div v-if="bgMode === 'color'" class="color-row">
            <button v-for="c in bgPresets.color" :key="c.value" class="color-dot" :style="{ background: c.value }" :class="{ active: bgColor === c.value }" :title="c.name" @click="setBgColor(c.value)"></button>
          </div>
          <div v-else-if="bgMode === 'gradient'" class="gradient-list">
            <button v-for="g in bgPresets.gradient" :key="g.name" class="gradient-item" :style="{ background: g.value }" :class="{ active: bgGradient === g.value }" @click="setBgGradient(g.value)">{{ g.name }}</button>
          </div>
          <div v-else-if="bgMode === 'image'" class="bg-image-actions">
            <button class="bg-import-btn" @click="importBgImage">🖼 导入自定义图片</button>
            <button v-if="bgImageUrl" class="bg-clear-btn" @click="clearBgImage">清除(恢复封面)</button>
            <div v-if="bgImageUrl" class="bg-image-preview" :style="{ backgroundImage: `url(${bgImageUrl})` }"></div>
          </div>
        </div>
      </div>

      <!-- 封面模式 -->
      <transition name="mode-fade">
        <div v-if="activeTab === 'cover'" key="cover" class="cover-mode">
        <div class="disc-area" title="点击进入歌词" @click="activeTab = 'lyric'">
          <div class="disc-ring" :class="{ spinning: playerStore.isPlaying }">
            <div class="disc-cover" :key="playerStore.currentSong?.path || 'none'">
              <img v-if="coverUrl" :src="coverUrl" @error="onCoverError" />
              <div v-else class="cover-placeholder">🎵</div>
            </div>
          </div>
        </div>
        <div class="song-meta" :key="'meta-' + (playerStore.currentSong?.path || 'none')">
          <h2 class="song-title">{{ playerStore.currentSong?.title || '未在播放' }}</h2>
          <div class="song-artist">{{ playerStore.currentSong?.artist || '' }}</div>
          <div class="song-album">{{ playerStore.currentSong?.album || '' }}</div>
          <div class="song-info" v-if="currentSongInfo">{{ currentSongInfo }}</div>
        </div>
      </div>
      </transition>
      <transition name="mode-fade">
        <div v-if="activeTab !== 'cover'" key="lyric" class="lyric-mode">
        <div class="lyric-left">
          <div class="disc-small" :class="{ spinning: playerStore.isPlaying }" title="返回封面" @click="activeTab = 'cover'">
            <div class="disc-cover-small">
              <img v-if="coverUrl" :src="coverUrl" @error="onCoverError" />
              <div v-else class="cover-placeholder">🎵</div>
            </div>
          </div>
          <div class="song-meta-small">
            <h2 class="song-title-sm">{{ playerStore.currentSong?.title || '未在播放' }}</h2>
            <div class="song-artist-sm">{{ playerStore.currentSong?.artist || '' }}</div>
          </div>
        </div>
        <div class="lyric-right">
          <!-- 歌词来源切换等竖排按钮:absolute 固定右侧栏右上,不随歌词滚动(fixed 受 transform 影响失效,sticky 占位遮挡) -->
          <div class="lyric-source-switch" :class="{ collapsed: lyricSidebarCollapsed }">
            <!-- 收起/展开按钮:收起时侧边栏缩成小竖条 -->
            <button class="ls-btn ls-collapse" :title="lyricSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'" @click="lyricSidebarCollapsed = !lyricSidebarCollapsed; localStorage.setItem('soundflow_lyric_sidebar', lyricSidebarCollapsed ? '1' : '0')">{{ lyricSidebarCollapsed ? '«' : '»' }}</button>
            <template v-if="!lyricSidebarCollapsed">
            <button v-for="opt in lyricSourceOptions" :key="opt.value" class="ls-btn" :class="{ active: lyricSource === opt.value }" @click="switchLyricSource(opt.value)">{{ opt.label }}</button>
            <button class="ls-btn" :class="{ active: showColorPanel }" title="歌词颜色" @click="showColorPanel = !showColorPanel">🎨</button>
            <button class="ls-btn" :class="{ active: playerStore.showTranslation }" title="歌词翻译" @click="playerStore.toggleTranslation()">{{ playerStore.translating ? '译中…' : '译' }}</button>
            <button class="ls-btn" :class="{ active: lyricAlign === 'left' }" title="歌词对齐(居中/左)" @click="toggleLyricAlign">对齐</button>
            <button class="ls-btn" :class="{ active: lyricEffect }" title="歌词特效(远近模糊/发光)" @click="lyricEffect = !lyricEffect; localStorage.setItem('soundflow_lyric_effect', lyricEffect ? '1' : '0')">✨</button>
            <button class="ls-btn" :class="{ active: lyricMode === 'word' }" :title="'歌词模式: ' + (lyricMode === 'word' ? '逐字高亮' : '整行高亮')" @click="toggleLyricMode">{{ lyricMode === 'word' ? '逐字' : '整行' }}</button>
            <button class="ls-btn ls-font" title="缩小歌词字号" @click="changeLyricFont(-2)">A−</button>
            <button class="ls-btn ls-font" title="放大歌词字号" @click="changeLyricFont(2)">A+</button>
            <button class="ls-btn ls-font" title="减小行距" @click="changeLyricGap(-0.15)">⭱</button>
            <button class="ls-btn ls-font" title="增大行距" @click="changeLyricGap(0.15)">⭳</button>
            </template>
          </div>
          <!-- 歌词颜色面板:跟随按钮组左侧 -->
          <div v-if="showColorPanel" class="color-panel" @click.stop>
            <div class="color-panel-title">歌词颜色</div>
            <button v-for="c in lyricColorOptions" :key="c.value" class="color-dot" :style="{ background: c.value }" :class="{ active: lyricColor === c.value }" :title="c.name" @click="setLyricColor(c.value)"></button>
          </div>
          <div class="lyrics-scroll" ref="lyricsPanel">
            <div v-if="playerStore.lyricOrigin" class="lyric-origin-tag">
              {{ playerStore.lyricOrigin }}歌词
              <button v-if="playerStore.lyricOrigin === '本地'" class="ls-del-btn" title="删除本地歌词" @click="deleteLocalLyric">🗑</button>
            </div>
            <div v-if="playerStore.lyrics.length === 0" class="lyrics-empty">
              <div class="empty-icon">📝</div>
              <div>{{ t('playerView.noLyrics') }}</div>
              <div class="empty-hint">右键歌曲可导入 .lrc 文件<br/>或在设置中添加歌词文件夹</div>
              <button class="search-lyric-btn" :disabled="searchingLyric" @click="searchLyric">
                {{ searchingLyric ? '正在搜索…' : '🔍 在线搜索歌词并下载' }}
              </button>
              <button class="search-lyric-btn local" @click="importLocalLyric">📄 导入本地歌词文件</button>
              <div v-if="searchLyricMsg" class="search-lyric-msg">{{ searchLyricMsg }}</div>
            </div>
            <div v-else class="lyrics-content" :class="{ 'no-lyric-effect': !lyricEffect }">
              <div style="height:40%"></div>
              <div
                v-for="(line, idx) in playerStore.lyrics"
                :key="idx"
                class="lyric-line"
                :class="{
                  active: idx === playerStore.currentLyricIndex,
                  left: lyricAlign === 'left',
                  near: lyricEffect && Math.abs(idx - playerStore.currentLyricIndex) === 1,
                  far: lyricEffect && Math.abs(idx - playerStore.currentLyricIndex) > 1
                }"
                :style="{
                  fontSize: (idx === playerStore.currentLyricIndex ? lyricFontSize + 4 : lyricFontSize) + 'px',
                  lineHeight: lyricLineGap,
                  color: idx === playerStore.currentLyricIndex ? lyricColor : lyricColor + '99',
                  textShadow: idx === playerStore.currentLyricIndex ? `0 0 22px ${lyricColor}66` : '0 1px 8px rgba(0,0,0,.55)'
                }"
                :title="'点击跳转到 ' + playerStore.formatTime(line.time)"
                @click="seekToLine(line)"
                :ref="el => { if (idx === playerStore.currentLyricIndex) activeLyricEl = el }"
              >
                <!-- 行时间戳:当前行常显,其他行 hover 显示(QQ 音乐风) -->
                <span class="lyric-time">{{ playerStore.formatTime(line.time) }}</span>
                <!-- 逐字高亮模式:当前行按字/词渲染,实时高亮当前字词(强调色区分) -->
                <template v-if="lyricMode === 'word' && idx === playerStore.currentLyricIndex">
                  <span v-for="(w, wi) in lyricWordSegments(line)" :key="wi"
                    class="lyric-word"
                    :class="{ cur: wi === currentWordIdx }"
                    :style="wi !== currentWordIdx ? { color: lyricColor + '77' } : {}"
                  >{{ w.c }}</span>
                </template>
                <template v-else>{{ line.text }}</template>
                <div v-if="playerStore.showTranslation && playerStore.translations[idx]" class="lyric-trans">{{ playerStore.translations[idx] }}</div>
              </div>
              <div style="height:40%"></div>
            </div>
          </div>
        </div>
      </div>
      </transition>

      <!-- 音频频谱:独立于面板常驻(切 tab 不销毁,即时恢复跳动);封面界面下方显示,歌词界面隐藏不占位 -->
      <canvas v-show="activeTab === 'cover'" ref="spectrumCanvas" class="spectrum-bar"></canvas>

      <!-- 底部控制栏 -->
      <div class="player-controls">
        <div class="controls-row">
          <!-- 播放控制组(居中:播放模式/上一曲/播放/下一曲/倍速,与播放栏一致) -->
          <div class="controls-group">
            <button class="ctrl-btn ctrl-mode" @click="playerStore.cyclePlayMode()" :title="t(playModeLabelKey)">
              <svg v-if="playerStore.playMode === 'list'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              <svg v-else-if="playerStore.playMode === 'repeat'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
              <svg v-else-if="playerStore.playMode === 'repeatOne'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/><text x="12" y="16" text-anchor="middle" font-size="9" fill="currentColor" stroke="none">1</text></svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
            </button>
            <button class="ctrl-btn ctrl-prev" @click="playerStore.playPrev()">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
            </button>
            <button class="ctrl-btn ctrl-btn--play" @click="playerStore.togglePlay()">
              <svg v-if="playerStore.isPlaying" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor"><polygon points="8,5 19,12 8,19"/></svg>
            </button>
            <button class="ctrl-btn ctrl-next" @click="playerStore.playNext()">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
            </button>
            <!-- 倍速(自定义) -->
            <div class="rate-control">
              <button class="ctrl-btn ctrl-btn--small" @click="showRatePanel = !showRatePanel" :title="t('player.rate', { x: playerStore.playbackRate })">
                {{ playerStore.playbackRate }}x
              </button>
              <transition name="vol-fade">
                <div v-if="showRatePanel" class="rate-panel" @click.stop>
                  <div class="pitch-header">
                    <span>播放速度</span>
                    <span class="pitch-value">{{ playerStore.playbackRate }}x</span>
                  </div>
                  <input type="range" min="0.25" max="3" step="0.05" :value="playerStore.playbackRate" @input="playerStore.setPlaybackRate(+$event.target.value)" />
                  <div class="rate-presets">
                    <button v-for="r in RATE_PRESETS" :key="r" class="rate-preset" :class="{ active: Math.abs(playerStore.playbackRate - r) < 0.001 }" @click="playerStore.setPlaybackRate(r)">{{ r }}x</button>
                  </div>
                  <div class="pitch-actions">
                    <button class="pitch-reset" @click="playerStore.setPlaybackRate(1)">重置 1x</button>
                  </div>
                </div>
              </transition>
            </div>

            <!-- 变调(升降调) -->
            <div class="pitch-control">
              <button class="ctrl-btn ctrl-btn--small" :class="{ active: playerStore.pitch !== 0 }" @click="showPitchPanel = !showPitchPanel" :title="t('playerView.pitch')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18"/><path d="M8 7l4-4 4 4"/><path d="M8 17l4 4 4-4"/></svg>
                <span v-if="playerStore.pitch !== 0" class="pitch-badge">{{ playerStore.pitch > 0 ? '+' : '' }}{{ playerStore.pitch }}</span>
              </button>
              <transition name="vol-fade">
                <div v-if="showPitchPanel" class="pitch-panel" @click.stop>
                  <div class="pitch-header">
                    <span>{{ t('playerView.pitch') }}</span>
                    <span class="pitch-value" :class="{ 'pitch-value--active': playerStore.pitch !== 0 }">{{ playerStore.pitch > 0 ? '+' : '' }}{{ playerStore.pitch }} st</span>
                  </div>
                  <!-- 常用预设:一键切换音高 -->
                  <div class="pitch-presets">
                    <button v-for="p in PITCH_PRESETS" :key="p.v" class="pitch-preset" :class="{ active: playerStore.pitch === p.v }" @click="playerStore.setPitch(p.v)">{{ p.label }}</button>
                  </div>
                  <!-- 变调模式:变速不变调 / 变速变调 -->
                  <div class="pitch-mode">
                    <button class="pitch-mode-btn" :class="{ active: !playerStore.pitchShiftTempo }" @click="playerStore.setPitchShiftTempo(false)">变速不变调</button>
                    <button class="pitch-mode-btn" :class="{ active: playerStore.pitchShiftTempo }" @click="playerStore.setPitchShiftTempo(true)">变速变调</button>
                  </div>
                  <div class="pitch-mode-hint">{{ playerStore.pitchShiftTempo ? '速度与音高同步变化(卡带/花栗鼠效果)' : '音高变化,速度不变' }}</div>
                  <!-- 网络流行音色:一键组合音高+变速 -->
                  <div class="voice-presets">
                    <button v-for="v in VOICE_PRESETS" :key="v.label" class="voice-preset" :class="{ active: playerStore.pitch === v.pitch && playerStore.pitchShiftTempo === v.tempo }" @click="applyVoice(v)">{{ v.label }}</button>
                  </div>
                  <input type="range" min="-12" max="12" step="1" :value="playerStore.pitch" @input="playerStore.setPitch(+$event.target.value)" />
                  <div class="pitch-scale">
                    <span>-12</span><span>0</span><span>+12</span>
                  </div>
                  <div class="pitch-actions">
                    <button class="pitch-reset" @click="playerStore.setPitch(0)">{{ t('playerView.pitchReset') }}</button>
                  </div>
                </div>
              </transition>
            </div>
          </div>

          <!-- 右侧工具组(桌面歌词 / 音量 / 音效 / 播放列表) -->
          <div class="tools-group">

            <!-- 桌面歌词 -->
            <button class="ctrl-btn ctrl-btn--small" :class="{ active: playerStore.desktopLyricState !== 0 }" @click="playerStore.cycleDesktopLyric()" :title="t('player.lyrics')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>

            </button>

            <!-- 音量(默认收起,点击图标展开滑块) -->
            <div class="volume-control" :class="{ expanded: volExpanded }">
              <button class="vol-btn" @click="volExpanded = !volExpanded" :title="t('player.volume')">
                <svg v-if="playerStore.isMuted || playerStore.volume === 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
              </button>
              <transition name="vol-fade">
                <div v-if="volExpanded" class="vol-pop">
                  <input type="range" class="vol-slider" min="0" max="1" step="0.01" :value="playerStore.volume" @input="setVolume" />
                </div>
              </transition>
            </div>

            <!-- 音效 -->
            <button class="ctrl-btn ctrl-btn--small" :class="{ active: showEqPanel || playerStore.eqSettings.enabled }" @click="showEqPanel = !showEqPanel" :title="t('player.eq')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3z"/></svg>
            </button>

            <!-- 播放列表 -->
            <button class="ctrl-btn ctrl-btn--small" data-queue-toggle :class="{ active: showQueuePanel }" @click="toggleQueuePanel" :title="t('player.queue')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
          </div>
        </div>

        <!-- 音效面板 -->
        <transition name="queue-slide">
          <div v-if="showEqPanel" class="eq-panel" @click.stop>
            <div class="queue-header">
              <span class="queue-title">音效</span>
              <button class="eq-toggle" :class="{ on: playerStore.eqSettings.enabled }" @click="playerStore.setEqEnabled(!playerStore.eqSettings.enabled)">
                {{ playerStore.eqSettings.enabled ? '已开启' : '已关闭' }}
              </button>
              <button class="queue-close" @click="showEqPanel = false">✕</button>
            </div>
            <div v-if="playerStore.eqSettings.enabled" class="eq-body">
              <!-- 频响曲线预览 -->
              <canvas ref="eqCurveCanvas" class="eq-curve"></canvas>
              <!-- 自定义预设 -->
              <div v-if="playerStore.customEqPresets.length" class="eq-group">
                <div class="eq-group-name">我的预设</div>
                <div class="eq-presets">
                  <button v-for="p in playerStore.customEqPresets" :key="p.name" class="eq-preset-btn" :class="{ active: playerStore.eqSettings.preset === 'custom:' + p.name }" @click="playerStore.applyCustomEqPreset(p.name)">
                    {{ p.name }}
                    <span class="eq-preset-del" @click.stop="deleteCustom(p.name)" title="删除">✕</span>
                  </button>
                </div>
              </div>
              <button class="eq-save-btn" @click="openSaveEq">💾 保存当前设置为预设</button>
              <div v-for="g in eqGroups" :key="g.name" class="eq-group">
                <div class="eq-group-name">{{ g.name }}</div>
                <div class="eq-presets">
                  <button v-for="key in g.keys" :key="key" class="eq-preset-btn" :class="{ active: playerStore.eqSettings.preset === key }" @click="playerStore.setEqPreset(key)">{{ playerStore.EQ_PRESETS[key].name }}</button>
                </div>
              </div>
              <div class="eq-sliders">
                <div v-for="(f, i) in playerStore.EQ_FREQS" :key="f" class="eq-slider-col">
                  <span class="eq-gain">{{ playerStore.eqSettings.gains[i] > 0 ? '+' : '' }}{{ playerStore.eqSettings.gains[i] }}</span>
                  <input type="range" min="-12" max="12" step="1" :value="playerStore.eqSettings.gains[i]" @input="playerStore.setEqGain(i, parseInt($event.target.value))" />
                  <span class="eq-freq">{{ f >= 1000 ? (f / 1000) + 'k' : f }}</span>
                </div>
              </div>
              <div class="eq-extra">
                <span class="label-text">重低音</span>
                <input type="range" min="-6" max="12" step="1" :value="playerStore.eqSettings.bass" @input="playerStore.setBass(parseInt($event.target.value))" />
                <span class="label-text">声场</span>
                <input type="range" min="0" max="1" step="0.05" :value="playerStore.eqSettings.reverb" @input="playerStore.setReverb(parseFloat($event.target.value))" />
              </div>
            </div>
            <div v-else class="eq-off">开启音效后,可调节均衡器、预设、重低音与空间声场</div>
            <!-- 保存自定义预设弹窗 -->
            <div v-if="showSaveEqModal" class="save-queue-mask" @click.self="showSaveEqModal = false">
              <div class="save-queue-card">
                <h3>保存为预设</h3>
                <input v-model="saveEqName" class="eq-name-input" placeholder="输入预设名称,如:我的最爱" @keyup.enter="confirmSaveEq" />
                <div class="eq-save-actions">
                  <button class="btn--ghost btn--sm" @click="showSaveEqModal = false">取消</button>
                  <button class="btn btn--sm" @click="confirmSaveEq">保存</button>
                </div>
              </div>
            </div>
          </div>
        </transition>
        <div class="progress-row">
          <ProgressBar />
        </div>

        <!-- 播放列表面板(打开自动定位当前歌曲) -->
        <transition name="queue-slide">
          <div v-if="showQueuePanel" class="queue-panel" :style="{ width: queueW + 'px', height: queueH + 'px' }">
            <div class="queue-header">
              <span class="queue-title">播放列表</span>
              <span class="queue-count">{{ playerStore.playQueue.length }} 首</span>
              <button v-if="playerStore.playQueue.length" class="queue-save" title="保存为歌单" @click="openSaveQueue">💾</button>
              <button v-if="playerStore.playQueue.length" class="queue-save" title="清空队列" @click="clearQueueConfirm">🗑</button>
              <button class="queue-close" @click="showQueuePanel = false">✕</button>
            </div>
            <div class="queue-list" ref="queueListEl">
              <div v-if="playerStore.playQueue.length === 0" class="queue-empty">队列为空</div>
              <div v-for="(song, idx) in playerStore.playQueue" :key="song.path + '-' + idx"
                class="queue-item" :class="{ active: idx === playerStore.currentIndex, 'drag-over': queueDragTarget === idx }"
                :ref="el => { if (idx === playerStore.currentIndex) activeQueueEl = el }"
                @click="playerStore.playIndex(idx)"
                @mousedown="onQueueMouseDown($event, idx)">
                <span class="queue-idx">{{ idx + 1 }}</span>
                <div class="queue-info">
                  <div class="queue-name text-ellipsis">{{ song.title }}</div>
                  <div class="queue-artist text-ellipsis">{{ song.artist }}</div>
                </div>
                <button class="queue-remove" @click.stop="playerStore.removeFromQueue(idx)" title="移除">✕</button>
              </div>
            </div>
            <!-- 右下角缩放手柄 -->
            <div class="queue-resize" @mousedown="onQueueResizeStart" title="拖动调整大小"></div>
          </div>
        </transition>

        <!-- 保存队列为歌单弹窗 -->
        <div v-if="saveQueueModal" class="save-queue-mask" @click.self="saveQueueModal = false">
          <div class="save-queue-card">
            <h3>保存为歌单</h3>
            <input v-model="saveQueueName" class="modal-input" placeholder="歌单名称" @keydown.enter="confirmSaveQueue" />
            <div class="edit-actions">
              <button class="modal-btn cancel" @click="saveQueueModal = false">取消</button>
              <button class="modal-btn confirm" :disabled="!saveQueueName.trim()" @click="confirmSaveQueue">保存</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import Sortable from 'sortablejs'
import { usePlayerStore } from '@/stores/playerStore'
import { useMusicStore } from '@/stores/musicStore'
import { useRouter } from 'vue-router'
import { t } from '@/i18n'
import ProgressBar from '@/components/ProgressBar.vue'

const playerStore = usePlayerStore()
const musicStore = useMusicStore()
const router = useRouter()

// 返回:历史栈为空时(如直接进入播放页)回退到主页,避免"返回键失灵"
function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/home')
}

// 保存播放队列为歌单
const saveQueueModal = ref(false)
const saveQueueName = ref('')
function openSaveQueue() {
  saveQueueName.value = ''
  saveQueueModal.value = true
}
function clearQueueConfirm() {
  if (!confirm('确定清空播放列表？')) return
  playerStore.stopPlayback()
  window.$toast?.('播放列表已清空', 'success')
}
function confirmSaveQueue() {
  const name = saveQueueName.value.trim()
  if (!name || !playerStore.playQueue.length) return
  const id = musicStore.createPlaylist(name)
  for (const s of playerStore.playQueue) {
    if (s && s.path) musicStore.addSongToPlaylist(id, s.path)
  }
  saveQueueModal.value = false
  try { window.$toast?.(`已保存歌单「${name}」(${playerStore.playQueue.length} 首)`, 'success') } catch {}
}
const progressBar = ref(null)
const lyricsPanel = ref(null)
const activeLyricEl = ref(null)

// 播放列表面板
const showQueuePanel = ref(false)
// 队列面板自由伸缩(尺寸记忆到 localStorage,min 260×240 / max 不超视口)
const queueW = ref(parseInt(localStorage.getItem('soundflow_queue_w')) || 320)
const queueH = ref(parseInt(localStorage.getItem('soundflow_queue_h')) || 380)
function onQueueResizeStart(e) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startY = e.clientY
  const sw = queueW.value
  const sh = queueH.value
  const onMove = (ev) => {
    queueW.value = Math.min(Math.max(sw + (ev.clientX - startX), 260), Math.min(560, window.innerWidth - 60))
    queueH.value = Math.min(Math.max(sh + (ev.clientY - startY), 240), window.innerHeight - 150)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    try {
      localStorage.setItem('soundflow_queue_w', String(queueW.value))
      localStorage.setItem('soundflow_queue_h', String(queueH.value))
    } catch {}
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
const queueListEl = ref(null)
let queueSortable = null
// 队列拖拽排序(Sortable 直接绑定 DOM,元素渲染时才创建;结束回调重排+修正索引)
function setupQueueSortable() {
  if (!queueListEl.value) return
  if (queueSortable) { try { queueSortable.destroy() } catch (_) {} }
  queueSortable = Sortable.create(queueListEl.value, {
    animation: 150,
    ghostClass: 'queue-ghost',
    onEnd: (evt) => {
      if (evt.oldIndex === undefined || evt.newIndex === undefined || evt.oldIndex === evt.newIndex) return
      const q = playerStore.playQueue
      const moved = q.splice(evt.oldIndex, 1)[0]
      q.splice(evt.newIndex, 0, moved)
      playerStore.fixQueueIndex(evt.oldIndex, evt.newIndex)
    }
  })
}
watch(showQueuePanel, (v) => { if (v) nextTick(setupQueueSortable) })
onUnmounted(() => { if (queueSortable) { try { queueSortable.destroy() } catch (_) {} } })
const activeQueueEl = ref(null)

// 音效面板
const showEqPanel = ref(false)
// 自定义预设保存弹窗
const showSaveEqModal = ref(false)
const saveEqName = ref('')
function openSaveEq() { saveEqName.value = ''; showSaveEqModal.value = true }
function confirmSaveEq() {
  const r = playerStore.saveCustomEqPreset(saveEqName.value)
  try { window.$toast?.(r.msg, r.ok ? 'success' : 'warning') } catch {}
  if (r.ok) showSaveEqModal.value = false
}
function deleteCustom(name) {
  playerStore.deleteCustomEqPreset(name)
  try { window.$toast?.('已删除预设「' + name + '」', 'success') } catch {}
}
// 队列 JS 拖拽排序(HTML5 DnD 在 Electron 不稳定,改用鼠标事件)
let queueDrag = null
const queueDragTarget = ref(null)
function onQueueMouseDown(e, idx) {
  if (e.button !== 0) return
  if (e.target.closest('button')) return
  queueDrag = { idx, startX: e.clientX, startY: e.clientY, moved: false }
  document.addEventListener('mousemove', onQueueDocMove)
  document.addEventListener('mouseup', onQueueDocUp)
}
function onQueueDocMove(e) {
  if (!queueDrag) return
  if (!queueDrag.moved && (Math.abs(e.clientX - queueDrag.startX) > 6 || Math.abs(e.clientY - queueDrag.startY) > 6)) {
    queueDrag.moved = true
  }
  if (queueDrag.moved) {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const row = el && el.closest('.queue-item')
    if (row) {
      const idx = [...row.parentElement.children].indexOf(row)
      queueDragTarget.value = idx >= 0 ? idx : null
    }
  }
}
function onQueueDocUp() {
  document.removeEventListener('mousemove', onQueueDocMove)
  document.removeEventListener('mouseup', onQueueDocUp)
  if (!queueDrag) return
  if (queueDrag.moved && queueDragTarget.value !== null && queueDragTarget.value !== queueDrag.idx) {
    playerStore.moveInQueue(queueDrag.idx, queueDragTarget.value)
  }
  queueDrag = null
  queueDragTarget.value = null
}
function onQueueDragLeave(idx) {
  if (queueDragTarget.value === idx) queueDragTarget.value = null
}
function onQueueDrop(idx) {
  const from = queueDrag ? queueDrag.idx : null
  if (from !== null && from !== idx) playerStore.moveInQueue(from, idx)
  queueDrag = null
  queueDragTarget.value = null
}
const eqGroups = [
  { name: '常用', keys: ['flat', 'pop', 'rock', 'jazz', 'classical', 'bass'] },
  { name: '风格', keys: ['electronic', 'hiphop', 'metal', 'blues', 'folk', 'dance'] },
  { name: '人声', keys: ['vocal', 'aiVocal', 'ktv', 'podcast'] },
  { name: '环绕', keys: ['surround', '5.1', 'open', 'surroundHQ', 'stage', 'power'] },
  { name: '律动', keys: ['dj', 'live'] },
  { name: '场景', keys: ['movie', 'tape', 'bathroom'] },
  { name: '趣味', keys: ['telephone', 'acg'] },
  { name: '更多', keys: ['auto', 'chinese'] }
]

function toggleQueuePanel() {
  showQueuePanel.value = !showQueuePanel.value
  if (showQueuePanel.value) {
    nextTick(() => scrollToActiveQueue())
  }
}
// 综合空白关闭:任何面板打开时挂全局监听,点击面板/触发按钮之外区域全部关闭
let _pvPanelWatch = null
function setupPvPanelsClickOutside() {
  if (_pvPanelWatch) return
  _pvPanelWatch = watch(
    [showQueuePanel, showEqPanel, showBgPanel, showColorPanel, volExpanded, showRatePanel, showPitchPanel],
    (vs) => {
      if (vs.some(Boolean)) document.addEventListener('click', onPvPanelDocClick)
      else document.removeEventListener('click', onPvPanelDocClick)
    }
  )
}
function onPvPanelDocClick(e) {
  // 面板内 / 触发按钮上点击不关闭
  if (e.target.closest('.queue-panel, .eq-panel, .bg-panel, .color-panel, .vol-pop, .rate-panel, .pitch-panel') ||
      e.target.closest('.ctrl-btn--small, .vol-btn, .icon-btn, [data-queue-toggle], .ls-btn')) return
  showQueuePanel.value = false
  showEqPanel.value = false
  showBgPanel.value = false
  showColorPanel.value = false
  volExpanded.value = false
  showRatePanel.value = false
  showPitchPanel.value = false
}

// 打开/切换歌曲时,自动定位当前播放项
function scrollToActiveQueue() {
  const list = queueListEl.value
  const el = activeQueueEl.value
  if (!list || !el) return
  // 用 getBoundingClientRect 相对定位,不依赖 offsetParent
  const listRect = list.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const target = elRect.top - listRect.top + list.scrollTop - list.clientHeight / 2 + elRect.height / 2
  list.scrollTop = Math.max(0, target)
}
watch(() => playerStore.currentIndex, () => {
  if (showQueuePanel.value) nextTick(() => scrollToActiveQueue())
})
const activeTab = ref('cover')
const coverUrl = computed(() => playerStore.currentSong?.coverUrl || null)
// 播放页信息行:比特率 · 采样率(数据来自 metadata 解析)
const currentSongInfo = computed(() => {
  const s = playerStore.currentSong
  if (!s) return ''
  const parts = []
  if (s.bitrate) parts.push(s.bitrate + ' kbps')
  if (s.sampleRate) parts.push((s.sampleRate / 1000).toFixed(1) + ' kHz')
  return parts.join(' · ')
})

// 封面容灾:封面文件丢失时重新生成
function onCoverError() {
  const song = playerStore.currentSong
  if (!song || song._coverRetried || !window.electronAPI) return
  song._coverRetried = true
  window.electronAPI.getCover(song.path)
    .then(url => { if (url) song.coverUrl = url })
    .catch(() => {})
}
const progressPercent = computed(() => playerStore.duration ? (playerStore.currentTime / playerStore.duration) * 100 : 0)

// ===== 播放页背景设置(封面 / 纯色 / 渐变,持久化) =====
const bgPresets = {
  color: [
    { name: '极夜黑', value: '#14161c' },
    { name: '深蓝', value: '#0f2440' },
    { name: '墨绿', value: '#12251c' },
    { name: '酒红', value: '#3a1418' },
    { name: '深紫', value: '#2a1745' },
    { name: '深棕', value: '#2b1e16' }
  ],
  gradient: [
    { name: '深蓝紫', value: 'linear-gradient(160deg, #1a1a3e 0%, #0d1b3a 50%, #1a1030 100%)' },
    { name: '落日橙', value: 'linear-gradient(160deg, #3a1a10 0%, #2a1508 55%, #121212 100%)' },
    { name: '森林绿', value: 'linear-gradient(160deg, #10241a 0%, #0d1a14 55%, #0a0f0c 100%)' },
    { name: '极夜', value: 'linear-gradient(160deg, #101014 0%, #0a0a0e 55%, #050508 100%)' },
    { name: '深海', value: 'linear-gradient(160deg, #0c2033 0%, #0a1724 55%, #070d14 100%)' }
  ]
}
const bgMode = ref(localStorage.getItem('soundflow_player_bg_mode') || 'cover')
const bgColor = ref(localStorage.getItem('soundflow_player_bg_color') || '#14161c')
const bgGradient = ref(localStorage.getItem('soundflow_player_bg_gradient') || bgPresets.gradient[0].value)
const bgImageUrl = ref(localStorage.getItem('soundflow_player_bg_image') || '')

function setBgMode(mode) {
  bgMode.value = mode
  localStorage.setItem('soundflow_player_bg_mode', mode)
}
function setBgColor(v) {
  bgColor.value = v
  setBgMode('color')
  localStorage.setItem('soundflow_player_bg_color', v)
}
function setBgGradient(v) {
  bgGradient.value = v
  setBgMode('gradient')
  localStorage.setItem('soundflow_player_bg_gradient', v)
}

// ===== 封面主色自动背景(auto 模式) =====
const bgAccent = ref(null)
const _dominantCache = new Map() // 按封面 URL 缓存主色,切歌不闪烁
function getDominantColor(imgUrl) {
  if (_dominantCache.has(imgUrl)) return Promise.resolve(_dominantCache.get(imgUrl))
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = 32; c.height = 32
        const ctx = c.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, 32, 32)
        const data = ctx.getImageData(0, 0, 32, 32).data
        let r = 0, g = 0, b = 0, n = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
        }
        if (!n) throw new Error('empty')
        const color = [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
        _dominantCache.set(imgUrl, color)
        if (_dominantCache.size > 200) _dominantCache.clear()
        resolve(color)
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = imgUrl
  })
}
// auto 模式下封面变化时异步取色(不阻塞渲染;失败保持深色)
watch([() => bgMode.value, coverUrl], async () => {
  if (bgMode.value !== 'auto' || !coverUrl.value) return
  bgAccent.value = await getDominantColor(coverUrl.value)
}, { immediate: true })

// 导入自定义背景图片
async function importBgImage() {
  if (!window.electronAPI) return
  const url = await window.electronAPI.selectBgImage()
  if (url) {
    bgImageUrl.value = url
    localStorage.setItem('soundflow_player_bg_image', url)
    setBgMode('image')
  }
}
function clearBgImage() {
  bgImageUrl.value = ''
  localStorage.removeItem('soundflow_player_bg_image')
  setBgMode('cover')
}

// 播放页背景(跟随当前主题的深色沉浸色 --player-bg-dark)
function getThemeDarkBg() {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--player-bg-dark').trim() || '#14161c'
  } catch { return '#14161c' }
}

// 主题色缓存:rAF 绘制循环里避免每帧 getComputedStyle(强制样式计算),10s TTL 防主题切换后长期旧色
let _accentCache = ''
let _accentT = 0
function getAccentColor() {
  const now = Date.now()
  if (!_accentCache || now - _accentT > 10000) {
    try { _accentCache = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#4096ff' } catch { _accentCache = '#4096ff' }
    _accentT = now
  }
  return _accentCache
}

const bgStyle = computed(() => {
  if (bgMode.value === 'theme') {
    return { backgroundColor: getThemeDarkBg() }
  }
  if (bgMode.value === 'color') {
    return { backgroundColor: bgColor.value }
  }
  if (bgMode.value === 'auto') {
    // 封面主色自动背景:主色暗化渐变(取色失败回退深色)
    if (bgAccent.value) {
      const [r, g, b] = bgAccent.value
      return {
        backgroundImage: `linear-gradient(160deg, rgb(${Math.round(r / 2.6)},${Math.round(g / 2.6)},${Math.round(b / 2.6)}) 0%, rgb(${Math.round(r / 1.8)},${Math.round(g / 1.8)},${Math.round(b / 1.8)}) 45%, #0e1016 100%)`
      }
    }
    return { backgroundColor: '#14161c' }
  }
  if (bgMode.value === 'gradient') {
    return { backgroundImage: bgGradient.value }
  }
  if (bgMode.value === 'image' && bgImageUrl.value) {
    return {
      backgroundImage: `url(${bgImageUrl.value})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    }
  }
  // 封面模式:封面铺底 + 深色遮罩压暗(避免 filter/backdrop-filter 叠加触发 Electron 渲染异常)
  if (coverUrl.value) {
    return {
      backgroundImage: `url(${coverUrl.value})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    }
  }
  return { backgroundColor: '#14161c' }
})

const playModeLabelKey = computed(() => {
  const keys = { list: 'player.mode.list', repeat: 'player.mode.repeat', repeatOne: 'player.mode.repeatOne', random: 'player.mode.random' }
  return keys[playerStore.playMode] || ''
})
const playModeLabel = computed(() => t(playModeLabelKey.value))

// 滚动歌词到当前播放行(近距离平滑/远距离直接跳)
function scrollToActiveLyric() {
  nextTick(() => {
    if (activeLyricEl.value && lyricsPanel.value) {
      const panel = lyricsPanel.value.getBoundingClientRect()
      const el = activeLyricEl.value.getBoundingClientRect()
      const dist = (el.top + el.height / 2) - (panel.top + panel.height / 2)
      activeLyricEl.value.scrollIntoView({ behavior: Math.abs(dist) <= 200 ? 'smooth' : 'auto', block: 'center' })
    }
  })
}

// 切歌时自动滚动歌词:近距离平滑、远距离直接跳(避免播放中每句 smooth 的持续合成开销)
watch(() => playerStore.currentLyricIndex, () => {
  scrollToActiveLyric()
})

// 进入歌词 tab 时跳转到当前播放行(播放一会后进歌词不再停在开头)
watch(activeTab, (v) => {
  if (v === 'lyric') scrollToActiveLyric()
})

// 切歌时自动切换到封面模式
watch(() => playerStore.currentSong, () => {
  activeTab.value = 'cover'
})

function onProgressClick(e) {
  if (!progressBar.value || !playerStore.duration) return
  const rect = progressBar.value.getBoundingClientRect()
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  playerStore.seek(percent * playerStore.duration)
}

function onProgressMouseDown(e) {
  onProgressClick(e)
  const onMove = (ev) => onProgressClick(ev)
  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function setVolume(e) { playerStore.setVolume(parseFloat(e.target.value)) }

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

// 歌词来源切换(本地 / 网易云 / LRCLIB / QQ音乐 / 自动),右侧竖排按钮
const lyricSourceOptions = [
  { value: 'auto', label: '自动' },
  { value: 'netease', label: '网易云' },
  { value: 'lrclib', label: 'LRCLIB' },
  { value: 'qq', label: 'QQ音乐' }
]
const lyricSource = ref((localStorage.getItem('soundflow_lyric_source') === 'local' ? 'auto' : (localStorage.getItem('soundflow_lyric_source') || 'auto')))
// 歌词右侧栏收起状态(持久化)
const lyricSidebarCollapsed = ref(localStorage.getItem('soundflow_lyric_sidebar') === '1')

// 歌词字号(可调,localStorage 持久化)
const lyricFontSize = ref(parseInt(localStorage.getItem('soundflow_lyric_font_size')) || 18)
function changeLyricFont(delta) {
  lyricFontSize.value = Math.max(12, Math.min(36, lyricFontSize.value + delta))
  localStorage.setItem('soundflow_lyric_font_size', String(lyricFontSize.value))
}

// 歌词行距(1.3-2.4,持久化)
const lyricLineGap = ref(parseFloat(localStorage.getItem('soundflow_lyric_gap')) || 1.6)
function changeLyricGap(delta) {
  lyricLineGap.value = Math.max(1.3, Math.min(2.4, Math.round((lyricLineGap.value + delta) * 100) / 100))
  localStorage.setItem('soundflow_lyric_gap', String(lyricLineGap.value))
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
const lyricColor = ref(localStorage.getItem('soundflow_lyric_color') || '#ffffff')
function setLyricColor(v) {
  lyricColor.value = v
  localStorage.setItem('soundflow_lyric_color', v)
  try { window.$toast?.('歌词颜色已更新', 'success') } catch {}
}
const showBgPanel = ref(false)
const showColorPanel = ref(false)
const lyricEffect = ref((() => { try { return localStorage.getItem('soundflow_lyric_effect') === '1' } catch { return false } })())
const volExpanded = ref(false) // 音量滑块默认收起
const PITCH_PRESETS = [
  { v: 0, label: '原声' },
  { v: -3, label: '男声' },
  { v: 4, label: '女声' },
  { v: 7, label: '童声' },
  { v: -2, label: '降' },
  { v: 2, label: '升' }
]
const showRatePanel = ref(false) // 倍速面板默认收起
const RATE_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
// 网络流行音色:音高 + 变速组合(变速变调时速度 ×2^(pitch/12),模拟各类变声)
const VOICE_PRESETS = [
  { label: '原声', pitch: 0, tempo: false },
  { label: '萝莉音', pitch: 7, tempo: true },
  { label: '御姐音', pitch: 4, tempo: false },
  { label: '花栗鼠', pitch: 8, tempo: true },
  { label: '曼波配音', pitch: 5, tempo: true },
  { label: '大叔音', pitch: -6, tempo: true },
  { label: '耄耋(老人)', pitch: -4, tempo: true },
  { label: '大狗叫', pitch: -9, tempo: true },
  { label: '慢速深沉', pitch: -5, tempo: true },
  { label: 'DJ电音', pitch: 2, tempo: false }
]
function applyVoice(v) {
  playerStore.setPitchShiftTempo(v.tempo)
  playerStore.setPitch(v.pitch)
}
const showPitchPanel = ref(false) // 变调面板默认收起

// 频响曲线可视化:随 EQ 滑块实时绘制
const eqCurveCanvas = ref(null)
function drawEqCurve() {
  const canvas = eqCurveCanvas.value
  if (!canvas) return
  // DPR 适配:按实际显示尺寸 × 像素比设置画布,避免拉伸模糊
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const fitW = Math.max(1, Math.round(rect.width * dpr))
  const fitH = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== fitW || canvas.height !== fitH) {
    canvas.width = fitW
    canvas.height = fitH
  }
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const gains = playerStore.eqSettings.gains
  const freqs = playerStore.EQ_FREQS
  const padL = 22, padR = 8, padT = 10, padB = 22
  const plotW = w - padL - padR, plotH = h - padT - padB
  const minF = 20, maxF = 20000
  const xOf = (f) => padL + Math.log10(f / minF) / Math.log10(maxF / minF) * plotW
  const yOf = (g) => padT + (12 - g) / 24 * plotH
  // 网格 + 0dB 参考线
  ctx.strokeStyle = 'rgba(128,128,160,0.14)'
  ctx.lineWidth = 1
  for (let db = -12; db <= 12; db += 6) {
    ctx.beginPath(); ctx.moveTo(padL, yOf(db)); ctx.lineTo(w - padR, yOf(db)); ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(128,128,160,0.32)'
  ctx.beginPath(); ctx.moveTo(padL, yOf(0)); ctx.lineTo(w - padR, yOf(0)); ctx.stroke()
  // 频率刻度
  ctx.fillStyle = 'rgba(200,200,220,0.45)'
  ctx.font = '9px sans-serif'
  ctx.textAlign = 'center'
  freqs.forEach(f => { ctx.fillText(f >= 1000 ? (f / 1000) + 'k' : f, xOf(f), h - 7) })
  // 曲线(贝塞尔平滑)
  const pts = freqs.map((f, i) => ({ x: xOf(f), y: yOf(gains[i]) }))
  const accent = getAccentColor()
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, mx, (pts[i - 1].y + pts[i].y) / 2)
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  ctx.stroke()
  // 渐变填充
  ctx.lineTo(pts[pts.length - 1].x, padT + plotH)
  ctx.lineTo(pts[0].x, padT + plotH)
  ctx.closePath()
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH)
  grad.addColorStop(0, accent + '44')
  grad.addColorStop(1, accent + '05')
  ctx.fillStyle = grad
  ctx.fill()
  // 频点圆点
  pts.forEach(p => {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
    ctx.fillStyle = accent
    ctx.fill()
  })
}
watch(() => playerStore.eqSettings.gains, () => nextTick(drawEqCurve), { deep: true })
watch(showEqPanel, (v) => { if (v) nextTick(drawEqCurve) })

// 频谱可视化(华丽版:左右对称镜像 + 圆头渐变条 + 峰值保持亮点 + 平滑动画)
const spectrumCanvas = ref(null)
let spectrumRAF = null
const BAR_COUNT = 72
const barVals = new Array(BAR_COUNT).fill(0)    // 当前平滑高度
const barPeaks = new Array(BAR_COUNT).fill(0)   // 峰值保持
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '')
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null
}
let lastSpecTs = 0
// 渐变缓存:主题色/高度不变时复用,避免每帧创建 gradient
let gradCache = { key: '', grad: null }
function drawSpectrum(ts) {
  const canvas = spectrumCanvas.value
  // canvas 被销毁(切 tab 时 v-if)必须重置 rAF 状态,否则 1s 兜底定时器误判"仍在运行"而永不重启
  if (!canvas) {
    spectrumRAF = null
    return
  }
  const playing = playerStore.isPlaying
  // 30fps 限帧:视觉仍流畅,主线程占用减半
  if (ts && ts - lastSpecTs < 33) {
    spectrumRAF = requestAnimationFrame(drawSpectrum)
    return
  }
  lastSpecTs = ts || 0
  // 不可见(隐藏/切tab)或未播放 → 停止绘制循环,避免空转耗 CPU
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0 || !playing) {
    spectrumRAF = null
    return
  }
  // DPR 适配:按实际显示尺寸 × 像素比设置画布,避免拉伸模糊
  const dpr = window.devicePixelRatio || 1
  const fitW = Math.max(1, Math.round(rect.width * dpr))
  const fitH = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== fitW || canvas.height !== fitH) {
    canvas.width = fitW
    canvas.height = fitH
  }
  // 每次取当前 canvas 的 context(切 tab 后 canvas 是新的,不能复用旧 context)
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  const data = playerStore.getSpectrumData()
  const half = BAR_COUNT / 2
  const barW = (width - (BAR_COUNT - 1) * 3) / BAR_COUNT
  const step = Math.max(1, Math.floor((data ? data.length : 0) / half))
  const accent = getAccentColor()
  const c = hexToRgb(accent) || { r: 64, g: 150, b: 255 }
  // 渐变缓存:key = 颜色+高度,复用渐变对象
  const gkey = (c.r + ',' + c.g + ',' + c.b) + '@' + height
  if (gradCache.key !== gkey) {
    const g = ctx.createLinearGradient(0, height, 0, 0)
    g.addColorStop(0, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.18)')
    g.addColorStop(0.7, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.85)')
    g.addColorStop(1, 'rgba(' + Math.min(255, c.r + 80) + ',' + Math.min(255, c.g + 80) + ',' + Math.min(255, c.b + 80) + ',1)')
    gradCache = { key: gkey, grad: g }
  }
  const grad = gradCache.grad

  for (let i = 0; i < BAR_COUNT; i++) {
    let target = 0
    if (data && playing) {
      // 左右对称:左半正序、右半镜像(呈现中间高两侧低的对称柱)
      const src = i < half ? i : BAR_COUNT - 1 - i
      let v = 0
      for (let j = 0; j < step; j++) v += data[src * step + j]
      v = v / step / 255
      target = Math.pow(v, 0.75) * (height - 6) // 提亮低能量段
    }
    // 平滑追高,回落稍快
    const diff = target - barVals[i]
    barVals[i] += diff * (diff > 0 ? 0.45 : 0.28)
    // 峰值保持:高于峰值则顶起,否则缓慢下落
    if (barVals[i] > barPeaks[i]) barPeaks[i] = barVals[i]
    else barPeaks[i] = Math.max(0, barPeaks[i] - 1.1)

    const barH = Math.max(3, barVals[i])
    const x = i * (barW + 3) + 1
    const y = height - barH
    const radius = Math.min(3, Math.max(1, barW / 2 - 0.5))

    // 主体:圆角渐变柱(底部透明→顶部亮色)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.roundRect(x, y, barW, barH, radius)
    ctx.fill()

    // 顶部高亮 cap(白色细亮条,金属感)
    if (barH > 6) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath()
      ctx.roundRect(x + 0.6, y + 1, barW - 1.2, Math.min(3, barH / 4), 1.4)
      ctx.fill()
    }

    // 柱底镜面高光(模拟水面反射点)
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.beginPath()
    ctx.roundRect(x + 1, height - 2.5, barW - 2, 2, 1)
    ctx.fill()

    // 峰值辉光点:主色光晕 + 白色核心
    if (barPeaks[i] > 3 && playing) {
      const py = height - barPeaks[i] - 2
      ctx.fillStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.4)'
      ctx.beginPath(); ctx.arc(x + barW / 2, py, 4.2, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.beginPath(); ctx.arc(x + barW / 2, py, 1.7, 0, Math.PI * 2); ctx.fill()
    }
  }
  // 底部发光基线(整体氛围,随低音微微起伏)
  const bass = data && playing ? Math.max(0.15, (data[0] || 0) / 255) : 0.15
  ctx.globalAlpha = 0.35 + bass * 0.4
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.roundRect(1, height - 2, width - 2, 2, 1)
  ctx.fill()
  ctx.globalAlpha = 1
  if (playing) spectrumRAF = requestAnimationFrame(drawSpectrum)
  else spectrumRAF = null
}
// 组件挂载后启动常驻绘制
function startSpectrum() {
  if (spectrumCanvas.value) drawSpectrum()
}
// 用定时轮询保证 canvas 一出现就恢复绘制(切 tab 卸载 canvas 会断 rAF,不依赖 watch 时序)—— 仅播放时存在,暂停/卸载即清
let spectrumTimer = null
function ensureSpectrumTimer() {
  if (spectrumTimer) return
  spectrumTimer = setInterval(() => {
    if (playerStore.isPlaying && !spectrumRAF) startSpectrum()
  }, 1000)
}
// 切回封面 tab 立即恢复频谱(canvas 常驻 v-show,切回瞬间即可绘制,无挂载延迟)
watch(activeTab, (v) => {
  if (v === 'cover' && playerStore.isPlaying && !spectrumRAF) startSpectrum()
})
// Esc 关闭播放页所有面板
function onPvEsc() {
  showQueuePanel.value = false
  showEqPanel.value = false
  showBgPanel.value = false
  showColorPanel.value = false
  volExpanded.value = false
  showRatePanel.value = false
  showPitchPanel.value = false
}
onMounted(() => {
  setupPvPanelsClickOutside()
  document.addEventListener('soundflow:esc', onPvEsc)
  if (playerStore.isPlaying) { startSpectrum(); ensureSpectrumTimer() }
  // 进入播放页时若歌词尚未加载(未播放过/切源后),补一次读取;本地歌词删除/外部修改后也能立即反映
  if (playerStore.currentSong && playerStore.lyrics.length === 0) {
    playerStore.loadLyrics(playerStore.currentSong)
  }
})
onUnmounted(() => {
  if (spectrumTimer) { clearInterval(spectrumTimer); spectrumTimer = null }
  if (spectrumRAF) { cancelAnimationFrame(spectrumRAF); spectrumRAF = null }
  document.removeEventListener('click', onPvPanelDocClick)
  document.removeEventListener('soundflow:esc', onPvEsc)
})
// 暂停时停止频谱 rAF(省 CPU),播放时恢复;定时器也随播放态启停
watch(() => playerStore.isPlaying, (v) => {
  if (v) { startSpectrum(); ensureSpectrumTimer() }
  else {
    if (spectrumRAF) { cancelAnimationFrame(spectrumRAF); spectrumRAF = null }
    if (spectrumTimer) { clearInterval(spectrumTimer); spectrumTimer = null }
    if (spectrumCanvas.value) {
      const ctx = spectrumCanvas.value.getContext('2d')
      ctx.clearRect(0, 0, spectrumCanvas.value.width, spectrumCanvas.value.height)
    }
  }
})

// 歌词对齐(居中/左,持久化)
const lyricAlign = ref(localStorage.getItem('soundflow_lyric_align') || 'center')
function toggleLyricAlign() {
  lyricAlign.value = lyricAlign.value === 'center' ? 'left' : 'center'
  localStorage.setItem('soundflow_lyric_align', lyricAlign.value)
}

// 歌词模式:整行 / 逐字高亮(持久化)
const lyricMode = ref(localStorage.getItem('soundflow_lyric_mode') || 'line')
function toggleLyricMode() {
  lyricMode.value = lyricMode.value === 'word' ? 'line' : 'word'
  localStorage.setItem('soundflow_lyric_mode', lyricMode.value)
}
// 当前逐字索引(基于 currentTime 与行内时间戳;标准LRC按均分时间近似)
const currentWordIdx = computed(() => {
  if (!playerStore.isPlaying) return -1
  const line = playerStore.lyrics[playerStore.currentLyricIndex]
  if (!line) return -1
  const segs = lyricWordSegments(line)
  if (!segs.length) return -1
  const t = playerStore.currentTime
  let idx = -1
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].t <= t) idx = i
    else break
  }
  return idx
})
// 文本切分为高亮段:英文按单词(带尾空格),中文按字,其他符号单字符
function splitLyricText(text) {
  const s = (text || '').trim()
  const out = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/[A-Za-z0-9]/.test(ch)) {
      // 连续英文/数字视为一个单词
      let j = i
      while (j < s.length && /[A-Za-z0-9'’\-]/.test(s[j])) j++
      out.push(s.slice(i, j) + ' ')
      i = j
    } else if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) {
      out.push(ch)
      i++
    } else if (/\s/.test(ch)) {
      i++ // 跳过空白
    } else {
      out.push(ch)
      i++
    }
  }
  return out
}
// 逐字渲染段:有增强时间戳直接用;无则按整行时长均分(英文逐词/中文逐字)
// 缓存:同一行文本只切分一次(currentTime 4Hz 重渲染不再重复正则+数组分配)
const _wordSegCache = new Map()
function lyricWordSegments(line) {
  if (!line) return []
  if (line.words && line.words.length) return line.words
  if (_wordSegCache.has(line.text)) return _wordSegCache.get(line.text)
  // 近似:按均分当前行到下一行之间的时长
  const cur = playerStore.lyrics[playerStore.currentLyricIndex]
  const next = playerStore.lyrics[playerStore.currentLyricIndex + 1]
  const start = cur ? cur.time : 0
  const end = next ? next.time : start + 4
  const dur = Math.max(0.5, end - start)
  const tokens = splitLyricText(line.text)
  if (!tokens.length) return []
  const per = dur / tokens.length
  const out = tokens.map((c, i) => ({ t: start + i * per, c }))
  if (_wordSegCache.size > 300) _wordSegCache.clear()
  _wordSegCache.set(line.text, out)
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
  if (!window.confirm('确定删除这首歌的本地歌词文件吗?\n删除后播放时将使用在线歌词。')) return
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

function switchLyricSource(v) {  if (lyricSource.value === v) return
  lyricSource.value = v
  localStorage.setItem('soundflow_lyric_source', v)
  const cur = playerStore.currentSong
  if (cur) {
    const label = lyricSourceOptions.find(o => o.value === v)?.label || v
    const hint = v === 'auto' ? '本地歌词优先,无本地时自动在线' : '在线歌词优先,获取失败回退本地'
    playerStore.loadLyrics(cur)
    window.$toast?.('已切换到「' + label + '」(' + hint + ')', 'success')
  }
}

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
      source: lyricSource === 'local' ? 'auto' : lyricSource
    })
    if (res?.lyrics) {
      const saved = await window.electronAPI.saveLyricFile(song.path, res.lyrics, lyricFoldersForSave())
      if (saved?.ok) {
        searchLyricMsg.value = '✅ 已保存到歌曲同目录'
        await playerStore.loadLyrics(song)
      } else {
        searchLyricMsg.value = '⚠️ 获取成功但保存失败'
      }
    } else {
      searchLyricMsg.value = '未找到歌词,可切换歌词来源(LRCLIB/QQ音乐/网易云)或稍后重试'
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
  background: rgba(0,0,0,0.68);
  display: flex; flex-direction: column;
}
.player-overlay.overlay-theme { background: rgba(0,0,0,0.15); }

/* 顶部栏 */
.player-topbar {
  position: relative;
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px; flex-shrink: 0;
}

.back-btn {
  display: flex; align-items: center; gap: 6px;
  color: rgba(255,255,255,0.7); font-size: var(--font-size-base);
}
.back-btn:hover { color: white; }
.back-btn svg { width: 20px; height: 20px; }

.tab-switcher { display: flex; gap: 4px; background: rgba(255,255,255,0.1); border-radius: 8px; padding: 3px; }
.tab-btn {
  padding: 6px 20px; border-radius: 6px; font-size: var(--font-size-sm);
  color: rgba(255,255,255,0.6); transition: all 0.2s;
}
.tab-btn.active { background: rgba(255,255,255,0.2); color: white; font-weight: 600; }
.tab-btn:hover { color: white; }

.topbar-right { display: flex; gap: 8px; }
.icon-btn {
  width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; color: rgba(255,255,255,0.6);
}
.icon-btn:hover { background: rgba(255,255,255,0.1); color: white; }
.icon-btn svg { width: 18px; height: 18px; }

/* ===== 封面模式 ===== */
.cover-mode {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  /* 圆盘与间距随窗口高度自适应,防止小窗口组件被挤出变形 */
  --disc: clamp(150px, min(32vh, 30vw), 300px);
  --gap: clamp(8px, 2.6vh, 32px);
  gap: var(--gap);
}

.disc-area { display: flex; flex-direction: column; align-items: center; }

.disc-ring {
  width: var(--disc, 300px); height: var(--disc, 300px); border-radius: 50%;
  border: 6px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  will-change: transform; /* 独立合成层,避免旋转触发整页重排 */
}
@keyframes disc-in {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
.song-meta { animation: meta-in 0.4s ease; }
@keyframes meta-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* tab 切换过渡 */
.mode-fade-enter-active, .mode-fade-leave-active { transition: opacity 0.16s cubic-bezier(.4,0,.2,1); }
.mode-fade-enter-from { opacity: 0; }
.mode-fade-leave-to { opacity: 0; }
.disc-ring.spinning { animation: spin 20s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.disc-cover {
  width: calc(var(--disc, 300px) - 30px); height: calc(var(--disc, 300px) - 30px); border-radius: 50%; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0,0,0,0.4);
  animation: disc-in 0.5s ease;
}
.disc-cover img { width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder {
  width: 100%; height: 100%; background: rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center; font-size: 64px;
}

.song-meta { text-align: center; }
.song-title { font-size: clamp(18px, 3.4vh, 26px); font-weight: 700; color: white; margin-bottom: 8px; }
.song-artist { font-size: var(--font-size-lg); color: rgba(255,255,255,0.6); }
.song-album { font-size: var(--font-size-base); color: rgba(255,255,255,0.4); margin-top: 4px; }
.song-info { font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 6px; letter-spacing: 0.3px; }

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
.spectrum-bar { display: block; margin: 14px auto 0; max-width: 520px; width: 100%; height: 80px; opacity: 0.9; }

.song-meta-small { text-align: center; }
.song-title-sm { font-size: 18px; font-weight: 600; color: white; margin-bottom: 4px; }
.song-artist-sm { font-size: var(--font-size-base); color: rgba(255,255,255,0.5); }

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

.lyrics-content { text-align: center; }

.lyrics-empty {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
  color: rgba(255,255,255,0.35); font-size: 18px;
}
.empty-icon { font-size: 48px; }
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
.lyric-time {
  display: none;
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--color-primary);
  opacity: 0.9;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  background: rgba(0,0,0,0.35);
  padding: 2px 6px;
  border-radius: 6px;
}
.lyric-line:hover .lyric-time { display: block; }
.lyric-line.active .lyric-time { display: block; color: #fff; background: var(--color-primary); }
.lyric-line.left { text-align: left; }
/* Apple Music 风格:远离当前句越远越模糊透明 */
.lyric-line.near { opacity: 0.55; filter: blur(0.4px); }
.lyric-line.far { opacity: 0.22; filter: blur(1.2px); }
.no-lyric-effect .lyric-line.near,
.no-lyric-effect .lyric-line.far { opacity: 0.6; filter: none; }
.lyric-word { transition: color 0.18s ease, text-shadow 0.18s ease; }
.lyric-word.cur { color: var(--color-primary); font-weight: 700; text-shadow: 0 0 18px var(--color-primary); }
.lyric-trans {
  font-size: 0.82em;
  font-weight: 400;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
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
  color: rgba(255,255,255,0.5);
  border-radius: 8px;
  text-align: center;
  transition: all 0.2s;
}
.ls-btn:hover { color: #fff; }
.ls-btn.active { background: var(--color-primary); color: #fff; }

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
.gradient-list { display: flex; flex-direction: column; gap: 6px; }
.gradient-item {
  padding: 10px 12px; border-radius: 8px; font-size: var(--font-size-xs); color: #fff;
  text-align: left; border: 2px solid transparent; transition: all 0.15s;
}
.gradient-item.active { border-color: #fff; }

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

/* ===== 底部控制栏 ===== */
.player-controls {
  flex-shrink: 0; padding: 16px 40px 24px;
  display: flex; flex-direction: column; gap: 12px;
}

.controls-row {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  min-height: 56px;
}
.controls-group {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex; align-items: center;
  /* 按钮全部绝对定位:播放键居中,上一曲/下一曲对称贴靠,模式/倍速两端 */
}
.tools-group {
  position: absolute;
  right: 32px;
  top: 50%;
  transform: translateY(-50%);
  display: flex; align-items: center; gap: 12px;
}
.ctrl-btn.active { color: var(--color-primary); }
.ctrl-btn--small { width: 34px; height: 34px; font-size: var(--font-size-sm); }
.ctrl-btn--small svg { width: 20px; height: 20px; }
.volume-control {
  position: relative; display: flex; align-items: center;
}
.vol-pop {
  position: absolute; bottom: calc(100% + 12px); left: 50%; transform: translateX(-50%);
  padding: 10px 8px;
  background: var(--bg-secondary, rgba(20,28,50,0.96));
  border: 1px solid var(--border-color, rgba(255,255,255,0.12));
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35);
  z-index: 60;
}
.vol-fade-enter-active, .vol-fade-leave-active { transition: opacity 0.18s; }
.vol-fade-enter-from, .vol-fade-leave-to { opacity: 0; }

/* 播放列表面板 */
.queue-panel {
  position: absolute;
  bottom: 76px;
  right: 20px;
  display: flex;
  flex-direction: column;
  background: rgba(18, 20, 28, 0.94);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  box-shadow: 0 16px 44px rgba(0,0,0,0.55);
  overflow: hidden;
  z-index: 30;
}
.queue-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.queue-title { font-size: var(--font-size-base); font-weight: 600; color: rgba(255,255,255,0.9); flex: 1; }
.queue-count { font-size: var(--font-size-xs); color: rgba(255,255,255,0.4); }
.queue-close { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: rgba(255,255,255,0.5); font-size: var(--font-size-sm); }
.queue-close:hover { background: rgba(255,255,255,0.1); color: white; }
.queue-save { background: none; border: none; color: var(--color-primary); font-size: 15px; cursor: pointer; padding: 2px 5px; }
.save-queue-mask { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.save-queue-card { width: 320px; padding: 20px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; color: var(--text-primary); }
.save-queue-card h3 { margin: 0 0 12px; font-size: 16px; }
.queue-list { position: relative; flex: 1; overflow-y: auto; padding: 6px; }
.queue-resize {
  position: absolute; right: 2px; bottom: 2px;
  width: 14px; height: 14px;
  cursor: nwse-resize;
  opacity: 0.35;
  background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.55) 50%);
  transition: opacity var(--transition-fast);
  z-index: 5;
}
.queue-resize:hover { opacity: 1; }
.queue-empty { text-align: center; color: rgba(255,255,255,0.35); font-size: var(--font-size-sm); padding: 30px 0; }
.queue-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
}
.queue-item.drag-over { background: var(--color-primary-alpha, rgba(64,150,255,0.25)); outline: 1px dashed var(--color-primary); }
.queue-item[draggable="true"] { cursor: grab; }
.queue-item[draggable="true"]:active { cursor: grabbing; }
.queue-item:hover { background: rgba(255,255,255,0.07); }
.queue-item.active { background: var(--color-primary-alpha); }
.queue-item.queue-ghost { opacity: 0.45; background: var(--color-primary-alpha); }
.queue-item { cursor: grab; }
.queue-item:active { cursor: grabbing; }
.queue-idx { width: 20px; font-size: var(--font-size-xs); color: rgba(255,255,255,0.3); text-align: center; flex-shrink: 0; }
.queue-item.active .queue-idx { color: var(--color-primary); }
.queue-info { flex: 1; min-width: 0; }
.queue-name { font-size: var(--font-size-sm); color: rgba(255,255,255,0.85); }
.queue-item.active .queue-name { color: var(--color-primary); font-weight: 500; }
.queue-artist { font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 1px; }
.queue-remove { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: rgba(255,255,255,0.4); font-size: 11px; opacity: 0; transition: all 0.15s; flex-shrink: 0; }
.queue-item:hover .queue-remove { opacity: 1; }
.queue-remove:hover { background: rgba(255,77,79,0.2); color: #ff6b6b; }
.queue-slide-enter-active, .queue-slide-leave-active { transition: opacity 0.22s, transform 0.22s; }
.queue-slide-enter-from, .queue-slide-leave-to { opacity: 0; transform: translateY(12px); }

/* 音效面板(播放页) */
.eq-panel {
  position: absolute; bottom: 76px; right: 20px;
  width: min(640px, 92vw); max-height: min(480px, 80vh);
  background: rgba(18, 20, 30, 0.98);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px; box-shadow: 0 16px 44px rgba(0,0,0,0.55);
  display: flex; flex-direction: column; z-index: 40; overflow: hidden;
}
.eq-toggle { padding: 3px 12px; font-size: var(--font-size-xs); border-radius: var(--radius-md); background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); }
.eq-toggle.on { background: var(--color-primary); color: #fff; }
.eq-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
.eq-curve { display: block; width: 100%; height: 130px; margin: 2px 0 6px; background: rgba(128,128,160,0.05); border-radius: 8px; flex-shrink: 0; }
.eq-off { padding: 24px; text-align: center; font-size: var(--font-size-sm); color: rgba(255,255,255,0.4); }
.eq-group { display: flex; flex-direction: column; gap: 5px; }
.eq-group-name { font-size: var(--font-size-xs); color: rgba(255,255,255,0.4); }
.eq-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.eq-preset-btn { font-size: var(--font-size-xs); padding: 4px 12px; border-radius: 999px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); transition: all var(--transition-fast); border: 1px solid transparent; cursor: pointer; }
.eq-preset-btn:hover { background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.9); }
.eq-preset-btn.active { background: var(--color-primary); color: #fff; box-shadow: 0 0 12px var(--color-primary-alpha, rgba(64,150,255,0.55)); }
.eq-preset-del { margin-left: 4px; opacity: 0.6; font-size: 10px; }
.eq-preset-del:hover { opacity: 1; color: #ff6b6b; }
.eq-save-btn { margin: 8px 0 2px; padding: 5px 12px; font-size: var(--font-size-xs); border-radius: 999px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.65); border: 1px dashed rgba(255,255,255,0.25); cursor: pointer; transition: all var(--transition-fast); }
.eq-save-btn:hover { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.eq-name-input { width: 100%; padding: 8px 10px; margin-bottom: 12px; border-radius: 8px; border: 1px solid var(--border-color); background: rgba(255,255,255,0.06); color: var(--text-primary); outline: none; }
.eq-save-actions { display: flex; justify-content: flex-end; gap: 8px; }
.eq-sliders { display: flex; justify-content: space-between; gap: 4px; }
.eq-slider-col { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
.eq-slider-col input[type="range"] { width: 100%; writing-mode: vertical-lr; direction: rtl; height: 100px; }
/* 滑杆美化:渐变轨道 + 发光圆点手柄 */
.eq-slider-col input[type="range"] { -webkit-appearance: none; appearance: none; background: transparent; cursor: pointer; }
.eq-slider-col input[type="range"]::-webkit-slider-runnable-track {
  width: 6px; border-radius: 3px;
  background: linear-gradient(to top, var(--color-primary, #4096ff), rgba(64,150,255,0.15));
}
.eq-slider-col input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; border-radius: 50%;
  background: #fff; border: 2px solid var(--color-primary, #4096ff);
  box-shadow: 0 0 8px var(--color-primary-alpha, rgba(64,150,255,0.8));
  margin-left: -4px; margin-top: 4px;
}
.eq-gain { font-size: 10px; color: rgba(255,255,255,0.55); font-variant-numeric: tabular-nums; min-height: 13px; }
/* 拖动滑杆时 dB 值高亮放大(气泡感) */
.eq-slider-col:focus-within .eq-gain { color: var(--color-primary); font-weight: 700; transform: scale(1.2); }
.eq-slider-col .eq-gain { transition: all 0.15s; }
.eq-gain { font-size: 10px; color: rgba(255,255,255,0.4); }
.eq-freq { font-size: 10px; color: rgba(255,255,255,0.4); }
.eq-extra { display: flex; align-items: center; gap: 8px; }
.eq-extra .label-text { min-width: 48px; }
.eq-extra input[type="range"] { width: 100px; }

.ctrl-btn {
  width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: rgba(255,255,255,0.8); font-size: 20px;
  transition: all 0.15s;
}
.ctrl-btn:hover { color: white; background: rgba(255,255,255,0.1); }
.ctrl-btn svg { width: 24px; height: 24px; }

.ctrl-btn--play {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 56px; height: 56px;
  background: var(--color-primary); color: white !important;
}
.ctrl-btn--play:hover { background: var(--color-primary-light); transform: translateX(-50%) scale(1.05); }
.ctrl-btn--play svg { width: 28px; height: 28px; }
/* 对称布局:播放键居中(56px),上一曲/下一曲(44px)贴靠两侧(间隙10px),模式/倍速对称两端 */
.ctrl-prev { position: absolute; right: calc(50% + 38px); }
.ctrl-next { position: absolute; left: calc(50% + 38px); }
.ctrl-mode { position: absolute; right: calc(50% + 102px); }

.progress-row { display: flex; align-items: center; gap: 12px; padding: 0 32px; }
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

.vol-slider {
  /* 竖直音量滑块:低在下、高在上 */
  -webkit-appearance: slider-vertical;
  appearance: slider-vertical;
  width: 4px; height: 100px;
  background: rgba(255,255,255,0.15); border-radius: 2px; outline: none;
}
.vol-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 13px; height: 13px;
  background: var(--color-primary, #4096ff); border-radius: 50%; cursor: pointer;
  border: none;
}

/* 变调控件 */
.pitch-control { position: relative; display: flex; align-items: center; }
.pitch-badge {
  position: absolute; top: -4px; right: -6px;
  font-size: 9px; font-weight: 700;
  background: var(--color-primary, #4096ff); color: #fff;
  border-radius: 8px; padding: 0 4px; line-height: 14px;
}
.pitch-panel {
  position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%);
  background: rgba(20,28,50,0.95); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px; padding: 10px 14px; width: 200px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35); z-index: 60;
  color: rgba(255,255,255,0.85);
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
.pitch-mode { display: flex; gap: 4px; margin-bottom: 4px; }
.pitch-mode-btn {
  flex: 1; padding: 3px 0; font-size: var(--font-size-sm, 11px);
  border: 1px solid var(--border-color, rgba(255,255,255,0.18)); border-radius: 6px;
  background: transparent; color: rgba(255,255,255,0.78); cursor: pointer; transition: all 0.15s;
}
.pitch-mode-btn:hover { border-color: #6ec6ff; }
.pitch-mode-btn.active { background: var(--color-primary, #4096ff); color: #fff; border-color: var(--color-primary, #4096ff); }
.pitch-mode-hint { font-size: 10px; color: rgba(255,255,255,0.5); margin-bottom: 6px; text-align: center; }
.voice-presets { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.voice-preset {
  flex: 1 1 30%; min-width: 58px; padding: 4px 0; font-size: var(--font-size-sm, 11px);
  border: 1px dashed var(--border-color, rgba(255,255,255,0.25)); border-radius: 6px;
  background: transparent; color: rgba(255,255,255,0.65); cursor: pointer; transition: all 0.15s;
}
.voice-preset:hover { border-color: #6ec6ff; color: #6ec6ff; }
.voice-preset.active { background: var(--color-primary, #4096ff); color: #fff; border-color: var(--color-primary, #4096ff); box-shadow: 0 0 0 1px var(--color-primary, #4096ff); }
.rate-control { position: relative; display: flex; align-items: center; }
/* 播放控制组对称定位(置于末尾确保优先级,覆盖上面相对定位):
   播放键居中,上一曲/下一曲贴靠,倍速/变调在右端对称排列 */
.rate-control { position: absolute; left: calc(50% + 102px); }
.pitch-control { position: absolute; left: calc(50% + 152px); }

.rate-panel {
  position: absolute; bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%);
  background: rgba(20,28,50,0.95); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px; padding: 10px 14px; width: 210px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.35); z-index: 60;
  color: rgba(255,255,255,0.85);
}
.rate-presets { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
.rate-preset {
  flex: 1; min-width: 38px; padding: 3px 0; font-size: var(--font-size-sm, 11px);
  border: 1px solid var(--border-color, rgba(255,255,255,0.18)); border-radius: 6px;
  background: transparent; color: rgba(255,255,255,0.78); cursor: pointer; transition: all 0.15s;
}
.rate-preset:hover { border-color: #6ec6ff; color: #6ec6ff; }
.rate-preset.active { background: var(--color-primary, #4096ff); color: #fff; border-color: var(--color-primary, #4096ff); }
.pitch-scale { display: flex; justify-content: space-between; font-size: 10px; color: rgba(255,255,255,0.5); margin-top: 2px; padding: 0 2px; }
.pitch-value--active { color: #fff; background: var(--color-primary, #4096ff); border-radius: 4px; padding: 0 6px; }
.pitch-actions { display: flex; justify-content: center; margin-top: 8px; }
.pitch-reset {
  font-size: var(--font-size-sm, 12px); padding: 3px 14px;
  border: 1px solid var(--border-color, rgba(255,255,255,0.15)); border-radius: 6px;
  background: transparent; color: rgba(255,255,255,0.78); cursor: pointer;
}
.pitch-reset:hover { background: rgba(255,255,255,0.1); }
</style>
