class MusicPlayer {
    constructor() {
        // Core DOM Elements
        this.audio = document.getElementById('audioEl');
        this.songListEl = document.getElementById('songList');

        // Controls
        this.btnPlayPause = document.getElementById('btnPlayPause');
        this.btnPrev = document.getElementById('btnPrev');
        this.btnNext = document.getElementById('btnNext');
        this.btnShuffle = document.getElementById('btnShuffle');
        this.btnRepeat = document.getElementById('btnRepeat');

        // Progress & Volume
        this.progressBar = document.getElementById('progressBar');
        this.progressFill = document.getElementById('progressFill');
        this.currentTimeEl = document.getElementById('currentTime');
        this.totalTimeEl = document.getElementById('totalTime');
        this.volumeSlider = document.getElementById('volumeSlider');

        // Meta
        this.playerTitle = document.getElementById('playerTitle');
        this.playerArtist = document.getElementById('playerArtist');
        this.playerCover = document.getElementById('playerCover');
        this.headerBadge = document.getElementById('headerBadge');
        this.searchInput = document.getElementById('searchInput');

        // Mobile UI
        this.sidebar = document.getElementById('sidebar');
        this.mobileOverlay = document.getElementById('mobileOverlay');
        this.mobileNavToggle = document.getElementById('mobileNavToggle');

        // State
        this.state = {
            songs: [],
            queue: [],
            currentIndex: -1,
            isPlaying: false,
            isShuffled: false,
            repeatMode: 'off', // 'off' | 'all' | 'one'
            volume: parseFloat(localStorage.getItem('volume') ?? 0.8),
            viewMode: 'songs', // 'songs' | 'devices'
            deviceList: [],
            playCounts: JSON.parse(localStorage.getItem('playCounts') || '{}'),
            deviceId: this.getDeviceId()
        };

        this.baseUrl = window.location.origin;
        this._counted = false;
        this._heartbeatTimer = null;
        this._devicePollTimer = null;

        this.init();
    }

    async init() {
        await this.loadSongs();
        this.setupEventListeners();
        this.restoreState();
        this.updateMostPlayedBadge();
        this.startHeartbeat();

        // Initial Volume
        this.audio.volume = this.state.volume;
        if (this.volumeSlider) this.volumeSlider.value = this.state.volume;

        // Visibility API
        document.addEventListener('visibilitychange', () => {
            const song = this.getCurrentSong();
            this.postStatus(song, this.state.isPlaying);
        });
        window.addEventListener('beforeunload', () => this.postStatus(null, false));
    }

    getCurrentSong() {
        return this.state.currentIndex >= 0 ? this.state.queue[this.state.currentIndex] : null;
    }

    async loadSongs() {
        try {
            const res = await fetch('json/songs.json', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this.state.songs = Array.isArray(data) ? data : [];
        } catch (e) {
            console.warn('Failed to load songs:', e);
            this.state.songs = [];
        }
        this.state.queue = [...this.state.songs];
        this.renderSongList();
    }

    renderSongList() {
        if (!this.songListEl) return;
        this.songListEl.innerHTML = '';

        if (this.state.viewMode === 'devices') {
            this.renderDeviceList();
            return;
        }

        this.state.queue.forEach((song, index) => {
            const row = document.createElement('div');
            row.className = 'song-row';
            row.dataset.index = String(index);
            row.dataset.id = song.id;

            // Highlight if playing
            if (this.state.currentIndex === index) row.classList.add('active');

            row.innerHTML = `
                <div class="song-index">${this.state.currentIndex === index ? '<i class="fas fa-volume-high"></i>' : index + 1}</div>
                <div class="song-title">${song.title || 'Unknown'}</div>
                <div class="song-artist">${song.artist || 'Unknown Artist'}</div>
                <div class="song-duration">${this.formatTime(song.duration)}</div>
            `;

            row.addEventListener('click', () => this.playSong(index));
            this.songListEl.appendChild(row);
        });
    }

    renderDeviceList() {
        // Ensure header exists
        let header = this.songListEl.querySelector('.device-header');
        if (!header) {
            this.songListEl.innerHTML = ''; // Clear only if we are initializing the view
            header = document.createElement('div');
            header.className = 'song-row device-header';
            header.style.cursor = 'default';
            header.style.background = 'transparent';
            header.innerHTML = `
                <div class="song-index">#</div>
                <div class="song-title">Device IP</div>
                <div class="song-artist">Status</div>
                <div class="song-duration"></div>
            `;
            this.songListEl.appendChild(header);
        }

        // Track existing IDs to remove stale ones
        const currentIds = new Set(this.state.deviceList.map(d => d.deviceId || d.ip));

        // Update or Create rows
        this.state.deviceList.forEach((d, i) => {
            const id = d.deviceId || d.ip;
            let row = this.songListEl.querySelector(`.song-row[data-device-id="${id}"]`);

            const statusText = d.isPlaying ? 'Playing' : 'Paused';
            const songText = d.song ? `${d.song.title} — ${d.song.artist}` : 'No Song';
            const statusHtml = `
                <span class="status-indicator ${d.isPlaying ? 'playing' : 'paused'}"></span>
                <span class="device-status-text">${statusText}</span>
                <span class="device-song-text">${songText}</span>
            `;

            if (row) {
                // Update existing
                const statusEl = row.querySelector('.song-artist');
                if (statusEl.innerHTML !== statusHtml) statusEl.innerHTML = statusHtml;

                // Update index if needed
                const indexEl = row.querySelector('.song-index');
                if (indexEl.textContent !== String(i + 1)) indexEl.textContent = i + 1;
            } else {
                // Create new
                row = document.createElement('div');
                row.className = 'song-row device-row';
                row.dataset.deviceId = id;
                row.innerHTML = `
                    <div class="song-index">${i + 1}</div>
                    <div class="song-title">${d.ip || 'Unknown IP'}</div>
                    <div class="song-artist">${statusHtml}</div>
                    <div class="song-duration"></div>
                `;
                this.songListEl.appendChild(row);
            }
        });

        // Remove stale rows
        const allRows = this.songListEl.querySelectorAll('.device-row');
        allRows.forEach(row => {
            if (!currentIds.has(row.dataset.deviceId)) {
                row.remove();
            }
        });
    }

    playSong(index) {
        if (index < 0 || index >= this.state.queue.length) return;

        this.state.currentIndex = index;
        const song = this.state.queue[index];

        if (!song?.url) return;

        this.audio.src = song.url;
        this._counted = false;

        this.audio.play()
            .then(() => {
                this.state.isPlaying = true;
                this.updateUI();
                this.persistState();
                this.postStatus(song, true);
            })
            .catch(err => console.error('Playback failed:', err));
    }

    togglePlayPause() {
        if (this.state.currentIndex === -1 && this.state.queue.length > 0) {
            this.playSong(0);
            return;
        }

        if (this.audio.paused) {
            this.audio.play().then(() => {
                this.state.isPlaying = true;
                this.updateUI();
                this.postStatus(this.getCurrentSong(), true);
            });
        } else {
            this.audio.pause();
            this.state.isPlaying = false;
            this.updateUI();
            this.postStatus(this.getCurrentSong(), false);
        }
    }

    nextSong() {
        if (this.state.queue.length === 0) return;
        let nextIdx = this.state.currentIndex + 1;
        if (nextIdx >= this.state.queue.length) {
            if (this.state.repeatMode === 'all') nextIdx = 0;
            else {
                this.state.isPlaying = false;
                this.updateUI();
                return;
            }
        }
        this.playSong(nextIdx);
    }

    prevSong() {
        if (this.state.queue.length === 0) return;
        // If > 3 seconds in, restart song
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }

        let prevIdx = this.state.currentIndex - 1;
        if (prevIdx < 0) {
            if (this.state.repeatMode === 'all') prevIdx = this.state.queue.length - 1;
            else prevIdx = 0;
        }
        this.playSong(prevIdx);
    }

    toggleShuffle() {
        this.state.isShuffled = !this.state.isShuffled;
        const currentSong = this.getCurrentSong();

        if (this.state.isShuffled) {
            // Fisher-Yates shuffle
            const arr = [...this.state.songs];
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            this.state.queue = arr;
        } else {
            this.state.queue = [...this.state.songs];
        }

        // Re-sync index
        if (currentSong) {
            this.state.currentIndex = this.state.queue.findIndex(s => s.id === currentSong.id);
        }

        this.btnShuffle.classList.toggle('active', this.state.isShuffled);
        this.renderSongList();
        this.persistState();
    }

    toggleRepeat() {
        const modes = ['off', 'all', 'one'];
        const next = (modes.indexOf(this.state.repeatMode) + 1) % modes.length;
        this.state.repeatMode = modes[next];

        this.btnRepeat.classList.toggle('active', this.state.repeatMode !== 'off');
        // Optional: Change icon for 'one'
        if (this.state.repeatMode === 'one') this.btnRepeat.innerHTML = '<i class="fas fa-repeat"></i><span style="font-size:8px;position:absolute;">1</span>';
        else this.btnRepeat.innerHTML = '<i class="fas fa-repeat"></i>';

        this.persistState();
    }

    seekAudio(e) {
        if (!this.audio.duration) return;
        const rect = this.progressBar.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        this.audio.currentTime = pos * this.audio.duration;
    }

    setVolume() {
        const v = parseFloat(this.volumeSlider.value);
        this.audio.volume = v;
        this.state.volume = v;
        localStorage.setItem('volume', String(v));
    }

    updateUI() {
        // Play/Pause Button
        if (this.btnPlayPause) {
            this.btnPlayPause.innerHTML = this.state.isPlaying
                ? '<i class="fas fa-pause-circle"></i>'
                : '<i class="fas fa-play-circle"></i>';
        }

        // Now Playing Info
        const song = this.getCurrentSong();
        if (this.playerTitle) this.playerTitle.textContent = song?.title || 'Not Playing';
        if (this.playerArtist) this.playerArtist.textContent = song?.artist || '—';

        // Cover Art
        if (this.playerCover) {
            if (song?.cover) {
                this.playerCover.style.backgroundImage = `url('${song.cover}')`;
            } else {
                this.playerCover.style.backgroundImage = 'linear-gradient(135deg, #333, #111)';
            }
        }

        // Highlight active row
        const rows = this.songListEl.querySelectorAll('.song-row');
        rows.forEach(r => r.classList.remove('active'));
        if (this.state.currentIndex >= 0) {
            const activeRow = this.songListEl.querySelector(`[data-index="${this.state.currentIndex}"]`);
            if (activeRow) {
                activeRow.classList.add('active');
                // Update index to icon
                const idxEl = activeRow.querySelector('.song-index');
                if (idxEl) idxEl.innerHTML = '<i class="fas fa-volume-high"></i>';
            }
        }
    }

    updateTime() {
        const curr = this.audio.currentTime || 0;
        const dur = this.audio.duration || 0;

        if (this.currentTimeEl) this.currentTimeEl.textContent = this.formatTime(curr);
        if (this.totalTimeEl) this.totalTimeEl.textContent = this.formatTime(dur);

        if (dur > 0 && this.progressFill) {
            const pct = (curr / dur) * 100;
            this.progressFill.style.width = `${pct}%`;
        }
    }

    setupEventListeners() {
        // Transport
        this.btnPlayPause?.addEventListener('click', () => this.togglePlayPause());
        this.btnNext?.addEventListener('click', () => this.nextSong());
        this.btnPrev?.addEventListener('click', () => this.prevSong());
        this.btnShuffle?.addEventListener('click', () => this.toggleShuffle());
        this.btnRepeat?.addEventListener('click', () => this.toggleRepeat());

        // Seek & Volume
        this.progressBar?.addEventListener('click', (e) => this.seekAudio(e));
        this.volumeSlider?.addEventListener('input', () => this.setVolume());

        // Audio Events
        this.audio.addEventListener('timeupdate', () => {
            this.updateTime();
            // Play count logic (>30s)
            if (!this._counted && this.audio.currentTime >= 30 && this.state.currentIndex >= 0) {
                const id = this.state.queue[this.state.currentIndex].id;
                this.incrementPlayCount(id);
                this._counted = true;
            }
        });
        this.audio.addEventListener('ended', () => {
            if (this.state.repeatMode === 'one') {
                this.audio.currentTime = 0;
                this.audio.play();
            } else {
                this.nextSong();
            }
        });
        this.audio.addEventListener('loadedmetadata', () => this.updateTime());

        // Search
        this.searchInput?.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            if (!term) {
                this.state.queue = [...this.state.songs];
            } else {
                this.state.queue = this.state.songs.filter(s =>
                    (s.title || '').toLowerCase().includes(term) ||
                    (s.artist || '').toLowerCase().includes(term)
                );
            }
            this.renderSongList();
        });

        // Navigation
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const view = btn.dataset.view;
                this.state.viewMode = view;

                if (view === 'devices') this.startDevicePolling();
                else this.stopDevicePolling();

                this.renderSongList();
                // Close mobile sidebar on nav click
                this.closeSidebar();
            });
        });

        // Mobile Sidebar
        this.mobileNavToggle?.addEventListener('click', () => this.openSidebar());
        this.mobileOverlay?.addEventListener('click', () => this.closeSidebar());
    }

    openSidebar() {
        this.sidebar.classList.add('open');
        this.mobileOverlay.classList.add('show');
    }
    closeSidebar() {
        this.sidebar.classList.remove('open');
        this.mobileOverlay.classList.remove('show');
    }

    // --- Helpers & API ---

    formatTime(s = 0) {
        if (!s || isNaN(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' : ''}${sec}`;
    }

    getDeviceId() {
        let id = localStorage.getItem('deviceId');
        if (!id) {
            id = 'dev-' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('deviceId', id);
        }
        return id;
    }

    incrementPlayCount(id) {
        this.state.playCounts[id] = (this.state.playCounts[id] || 0) + 1;
        localStorage.setItem('playCounts', JSON.stringify(this.state.playCounts));
        this.updateMostPlayedBadge();

        fetch(`${this.baseUrl}/api/play`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        }).catch(() => { });
    }

    updateMostPlayedBadge() {
        if (!this.headerBadge) return;
        const entries = Object.entries(this.state.playCounts);
        if (!entries.length) {
            this.headerBadge.textContent = 'Most Played: —';
            return;
        }
        entries.sort((a, b) => b[1] - a[1]);
        const [topId, count] = entries[0];
        const song = this.state.songs.find(s => s.id === topId);
        this.headerBadge.textContent = song
            ? `Most Played: ${song.title} (${count})`
            : 'Most Played: —';
    }

    startDevicePolling() {
        this.stopDevicePolling();
        const poll = async () => {
            try {
                const res = await fetch(`${this.baseUrl}/api/devices`);
                if (res.ok) {
                    this.state.deviceList = await res.json();
                    if (this.state.viewMode === 'devices') this.renderDeviceList();
                }
            } catch (e) { }
        };
        poll();
        this._devicePollTimer = setInterval(poll, 5000);
    }
    stopDevicePolling() {
        if (this._devicePollTimer) clearInterval(this._devicePollTimer);
    }

    startHeartbeat() {
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = setInterval(() => {
            this.postStatus(this.getCurrentSong(), this.state.isPlaying);
        }, 10000);
        this.postStatus(this.getCurrentSong(), this.state.isPlaying);
    }

    async postStatus(song, isPlaying) {
        try {
            await fetch(`${this.baseUrl}/api/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: this.state.deviceId,
                    songId: song?.id ?? null,
                    isPlaying: !!isPlaying,
                    title: song?.title ?? null,
                    artist: song?.artist ?? null
                })
            });
        } catch (e) { }
    }

    persistState() {
        localStorage.setItem('musicPlayerState', JSON.stringify({
            volume: this.state.volume,
            repeatMode: this.state.repeatMode,
            isShuffled: this.state.isShuffled,
            currentSong: this.getCurrentSong()?.id
        }));
    }

    restoreState() {
        try {
            const saved = JSON.parse(localStorage.getItem('musicPlayerState'));
            if (saved) {
                this.state.repeatMode = saved.repeatMode || 'off';
                this.state.isShuffled = !!saved.isShuffled;
                if (this.state.isShuffled) this.btnShuffle.classList.add('active');

                // Restore last song
                if (saved.currentSong) {
                    const idx = this.state.songs.findIndex(s => s.id === saved.currentSong);
                    if (idx >= 0) {
                        this.state.currentIndex = idx;
                        const song = this.state.songs[idx];
                        this.audio.src = song.url;
                        this.updateUI();
                    }
                }
            }
        } catch (e) { }
    }
}

document.addEventListener('DOMContentLoaded', () => new MusicPlayer());
