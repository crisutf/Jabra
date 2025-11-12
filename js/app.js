class MusicPlayer {
    constructor() {
        // Core DOM
        this.audio = document.getElementById('audioEl');
        this.songListEl = document.getElementById('songList');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.shuffleBtn = document.getElementById('shuffleBtn');
        this.repeatBtn = document.getElementById('repeatBtn');
        this.volumeRange = document.getElementById('volumeRange');
        this.seekRange = document.getElementById('seekRange');
        this.currentTimeEl = document.getElementById('currentTime');
        this.totalTimeEl = document.getElementById('totalTime');
        this.npTitle = document.getElementById('npTitle');
        this.npArtist = document.getElementById('npArtist');
        this.coverEl = document.getElementById('cover');

        // Optional elements (desktop only)
        this.searchInput = document.getElementById('searchInput') || null;
        this.mostPlayedEl = document.getElementById('mostPlayed') || null;

        // State
        this.state = {
            songs: [],
            queue: [],
            currentIndex: -1,
            isPlaying: false,
            isShuffled: false,
            repeatMode: 'off', // 'off' | 'all' | 'one'
            volume: parseFloat(localStorage.getItem('volume') ?? 0.8),
            favorites: new Set(),
            // {{ edit_1 }} REMOVED TV-specific state: focusIndex and isTv
            isMobile: document.body.classList.contains('device-mobile'),
            playCounts: JSON.parse(localStorage.getItem('playCounts') || '{}'),
            viewMode: 'songs',              // 'songs' | 'devices'
            devicePollTimer: null,
            deviceList: []
        };

        // Internal flags
        this._counted = false;

        // Base URL and heartbeat
        this.baseUrl = window.location.origin;
        this._heartbeatTimer = null;

        // Persistent device ID
        this.deviceId = this.getDeviceId();

        this.init();
    }

    async init() {
        await this.loadSongs();
        this.setupEventListeners();
        // {{ edit_2 }} REMOVED TV setup
        // if (this.state.isTv) this.setupTvControls();
        this.restoreState();
        this.updateMostPlayedBadge();
        this.syncPreferredLayout();

        // Start heartbeat and status wiring
        this.startHeartbeat();
        window.addEventListener('beforeunload', () => this.postStatus(null, false));
        document.addEventListener('visibilitychange', () => {
            const song = this.state.currentIndex >= 0 ? this.state.queue[this.state.currentIndex] : null;
            this.postStatus(song, this.state.isPlaying);
        });
    }

    // Preferred layout helpers (desktop | mobile | tv)
    getLayoutFromBody() {
        if (document.body.classList.contains('device-tv')) return 'tv';
        if (document.body.classList.contains('device-mobile')) return 'mobile';
        return 'desktop';
    }
    getPreferredLayout() {
        return localStorage.getItem('preferredLayout') || 'desktop';
    }
    setPreferredLayout(layout) {
        if (!['desktop', 'mobile', 'tv'].includes(layout)) return;
        localStorage.setItem('preferredLayout', layout);
        fetch(`${this.baseUrl}/api/layout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layout })
        }).catch(() => {});
    }
    syncPreferredLayout() {
        const current = this.getLayoutFromBody();
        const stored = this.getPreferredLayout();
        if (stored !== current) this.setPreferredLayout(current);
    }

    async loadSongs() {
        try {
            const res = await fetch('json/songs.json', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this.state.songs = Array.isArray(data) ? data : [];
        } catch (e) {
            console.warn('Failed to load json/songs.json:', e);
            this.state.songs = [];
        }
        this.state.queue = [...this.state.songs];
        this.renderSongList();
    }

    renderSongList() {
        if (!this.songListEl) return;
        this.songListEl.innerHTML = '';

        this.state.queue.forEach((song, index) => {
            const row = document.createElement('div');
            row.className = 'song-item';
            row.dataset.index = String(index);
            row.dataset.id = song.id;
            row.innerHTML = `
                <div class="index">${index + 1}</div>
                <div class="title">${song.title || 'Unknown'}</div>
                <div class="artist">${song.artist || '—'}</div>
                <div class="album">${song.album || '—'}</div>
                <div class="duration">${song.duration ? this.formatTime(song.duration) : '—'}</div>
            `;
            row.addEventListener('click', () => this.playSong(index));
            this.songListEl.appendChild(row);
        });

        this.highlightPlayingRow();
        // {{ edit_3 }} REMOVED TV focus highlight
        // if (this.state.isTv) this.highlightFocusRow();
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
                this.updatePlayPauseButton();
                this.updateNowPlaying(song);
                this.highlightPlayingRow();
                this.persistState();
                this.postStatus(song, true);
            })
            .catch(err => console.error('Playback failed:', err));
    }

    togglePlayPause() {
        // FIX: avoid race conditions on audio.play() and update status only when state changes
        if (this.state.currentIndex === -1 && this.state.queue.length > 0) {
            this.playSong(0);
            return;
        }

        if (this.audio.paused) {
            this.audio.play()
                .then(() => {
                    this.state.isPlaying = true;
                    this.updatePlayPauseButton();
                    const song = this.state.currentIndex >= 0 ? this.state.queue[this.state.currentIndex] : null;
                    if (song) this.postStatus(song, true);
                })
                .catch(err => console.error('Playback failed:', err));
        } else {
            this.audio.pause();
            this.state.isPlaying = false;
            this.updatePlayPauseButton();
            const song = this.state.currentIndex >= 0 ? this.state.queue[this.state.currentIndex] : null;
            if (song) this.postStatus(song, false);
        }
    }

    nextSong() {
        if (this.state.queue.length === 0) return;
        const lastIndex = this.state.queue.length - 1;
        let nextIdx = this.state.currentIndex + 1;

        if (nextIdx > lastIndex) {
            if (this.state.repeatMode === 'all') nextIdx = 0;
            else {
                this.state.isPlaying = false;
                this.updatePlayPauseButton();
                return;
            }
        }
        this.playSong(nextIdx);
    }

    prevSong() {
        if (this.state.queue.length === 0) return;
        let prevIdx = this.state.currentIndex - 1;

        if (prevIdx < 0) {
            if (this.state.repeatMode === 'all') prevIdx = this.state.queue.length - 1;
            else prevIdx = 0;
        }
        this.playSong(prevIdx);
    }

    toggleShuffle() {
        this.state.isShuffled = !this.state.isShuffled;

        const currentSong = this.state.currentIndex >= 0 ? this.state.queue[this.state.currentIndex] : null;
        if (this.state.isShuffled) {
            // Shuffle songs
            const arr = [...this.state.songs];
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            this.state.queue = arr;
        } else {
            this.state.queue = [...this.state.songs];
        }

        // Keep current song selection if any
        if (currentSong) {
            const idx = this.state.queue.findIndex(s => s.id === currentSong.id);
            this.state.currentIndex = idx !== -1 ? idx : -1;
        }

        this.renderSongList();
        this.highlightPlayingRow();
        this.persistState();
    }

    handleSongEnd() {
        // count if user scrubbed fast and <30s wasn’t reached
        if (!this._counted && this.state.currentIndex >= 0) {
            const id = this.state.queue[this.state.currentIndex].id;
            this.incrementPlayCount(id);
            this._counted = true;
        }

        const song = this.state.currentIndex >= 0 ? this.state.queue[this.state.currentIndex] : null;
        if (song) this.postStatus(song, false);

        if (this.state.repeatMode === 'one') {
            this.audio.currentTime = 0;
            this.audio.play();
        } else {
            this.nextSong();
        }
    }

    setupEventListeners() {
        // Buttons
        this.playPauseBtn?.addEventListener('click', () => this.togglePlayPause());
        this.prevBtn?.addEventListener('click', () => this.prevSong());
        this.nextBtn?.addEventListener('click', () => this.nextSong());
        this.shuffleBtn?.addEventListener('click', () => this.toggleShuffle());
        this.repeatBtn?.addEventListener('click', () => this.toggleRepeat());
        this.volumeRange?.addEventListener('input', () => this.setVolume());
        this.seekRange?.addEventListener('input', () => this.seekAudio());

        // Audio events
        this.audio.addEventListener('timeupdate', () => {
            this.updateTime();
            // count a play after 30s of listening
            if (!this._counted && this.audio.currentTime >= 30 && this.state.currentIndex >= 0) {
                const id = this.state.queue[this.state.currentIndex].id;
                this.incrementPlayCount(id);
                this._counted = true;
            }
        });
        this.audio.addEventListener('ended', () => this.handleSongEnd());
        this.audio.addEventListener('loadedmetadata', () => this.updateDuration());

        // Search
        if (this.searchInput) {
            this.searchInput.addEventListener('input', () => this.searchSongs(this.searchInput.value));
            const icon = this.searchInput.previousElementSibling;
            icon?.addEventListener('click', () => this.searchInput.focus());
        }

        // Playlist filters
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this.filterSongs(item.dataset.playlist);
            });
        });
    }

    toggleRepeat() {
        const modes = ['off', 'all', 'one'];
        const next = (modes.indexOf(this.state.repeatMode) + 1) % modes.length;
        this.state.repeatMode = modes[next];
        if (this.repeatBtn) {
            this.repeatBtn.innerHTML = `<i class="fas fa-redo"></i>`;
            this.repeatBtn.style.color = this.state.repeatMode === 'off' ? '' : 'var(--primary)';
        }
        this.persistState();
    }

    // Search/filter
    searchSongs(query) {
        const searchTerm = (query || '').toLowerCase();
        this.state.queue = this.state.songs.filter(song =>
            (song.title || '').toLowerCase().includes(searchTerm) ||
            (song.artist || '').toLowerCase().includes(searchTerm) ||
            (song.album || '').toLowerCase().includes(searchTerm)
        );
        this.renderSongList();
        this.highlightPlayingRow();
    }

    filterSongs(filter) {
        switch (filter) {
            case 'devices':
                this.state.viewMode = 'devices';
                this.startDevicePolling();
                this.renderDeviceList();
                return;

            case 'favorites':
                this.state.queue = this.state.songs.filter(song => this.state.favorites.has(song.id));
                break;

            case 'all':
            default:
                this.state.viewMode = 'songs';
                this.stopDevicePolling();
                this.state.queue = [...this.state.songs];
                break;
        }
        this.renderSongList();
        this.highlightPlayingRow();
    }

    renderDeviceList() {
        if (!this.songListEl) return;
        this.songListEl.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'song-item devices-header';
        header.innerHTML = `
            <div class="index">#</div>
            <div class="title">IP</div>
            <div class="artist">Device</div>
            <div class="album">Song</div>
            <div class="duration">Status</div>
        `;
        this.songListEl.appendChild(header);

        this.state.deviceList.forEach((d, i) => {
            const row = document.createElement('div');
            row.className = 'song-item';
            row.innerHTML = `
                <div class="index">${i + 1}</div>
                <div class="title">${d.ip || '—'}</div>
                <div class="artist">${d.deviceId || '—'}</div>
                <div class="album">${d.song ? `${d.song.title} — ${d.song.artist}` : '—'}</div>
                <div class="duration">${d.isPlaying ? 'Playing' : 'Paused'}</div>
            `;
            this.songListEl.appendChild(row);
        });
    }

    startDevicePolling() {
        this.stopDevicePolling();
        const poll = async () => {
            try {
                const res = await fetch(`${this.baseUrl}/api/devices`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const list = await res.json();
                this.state.deviceList = Array.isArray(list) ? list : [];
                if (this.state.viewMode === 'devices') this.renderDeviceList();
            } catch (e) {
                console.warn('Device poll failed:', e);
            }
        };
        poll();
        this.state.devicePollTimer = setInterval(poll, 5000);
    }
    stopDevicePolling() {
        if (this.state.devicePollTimer) {
            clearInterval(this.state.devicePollTimer);
            this.state.devicePollTimer = null;
        }
    }

    async postStatus(song, isPlaying) {
        try {
            const payload = {
                deviceId: this.deviceId,
                songId: song?.id ?? null,
                isPlaying: !!isPlaying,
                title: song?.title ?? null,
                artist: song?.artist ?? null
            };
            const res = await fetch(`${this.baseUrl}/api/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            console.warn('postStatus failed:', err);
        }
    }

    // Heartbeat every 10s so device stays visible
    startHeartbeat() {
        this.stopHeartbeat();
        this._heartbeatTimer = setInterval(() => {
            const song = this.state.currentIndex >= 0 ? this.state.queue[this.state.currentIndex] : null;
            this.postStatus(song, this.state.isPlaying);
        }, 10000);
        // initial ping
        const song = this.state.currentIndex >= 0 ? this.state.queue[this.state.currentIndex] : null;
        this.postStatus(song, this.state.isPlaying);
    }
    stopHeartbeat() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
    }

    getDeviceId() {
        const existing = localStorage.getItem('deviceId');
        if (existing) return existing;
        const rand = (crypto && crypto.getRandomValues)
            ? crypto.getRandomValues(new Uint32Array(2)).join('-')
            : `${Date.now()}-${Math.random()}`;
        const id = `dev-${rand}`;
        localStorage.setItem('deviceId', id);
        return id;
    }

    updateTime() {
        const currentTime = this.audio.currentTime || 0;
        if (this.currentTimeEl) this.currentTimeEl.textContent = this.formatTime(currentTime);

        if (this.audio.duration && isFinite(this.audio.duration)) {
            const progress = (currentTime / this.audio.duration) * 100;
            if (this.seekRange) this.seekRange.value = String(progress);
        }
    }

    updateDuration() {
        const dur = (this.audio.duration && isFinite(this.audio.duration))
            ? this.audio.duration
            : (this.state.currentIndex >= 0 ? (this.state.queue[this.state.currentIndex]?.duration || 0) : 0);
        if (this.totalTimeEl) this.totalTimeEl.textContent = this.formatTime(dur);
    }

    seekAudio() {
        if (!this.audio.duration || !isFinite(this.audio.duration)) return;
        const seekTime = (parseFloat(this.seekRange.value) / 100) * this.audio.duration;
        this.audio.currentTime = seekTime;
    }

    setVolume() {
        const v = parseFloat(this.volumeRange.value);
        this.audio.volume = isNaN(v) ? 0.8 : v;
        this.state.volume = this.audio.volume;
        localStorage.setItem('volume', String(this.state.volume));
    }

    formatTime(seconds = 0) {
        const s = Math.max(0, Math.floor(seconds));
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    highlightPlayingRow() {
        if (!this.songListEl) return;
        Array.from(this.songListEl.children).forEach(r => r.classList.remove('playing'));
        if (this.state.currentIndex >= 0) {
            const row = this.songListEl.querySelector(`[data-index="${this.state.currentIndex}"]`);
            row?.classList.add('playing');
        }
    }

    setupTvControls() {
        this.state.focusIndex = Math.max(0, Math.min(this.state.queue.length - 1, this.state.focusIndex));
        this.highlightFocusRow();

        document.addEventListener('keydown', (e) => {
            const max = this.state.queue.length - 1;
            if (['ArrowDown','ArrowUp','Enter',' '].includes(e.key) || e.code === 'MediaPlayPause') e.preventDefault();

            switch (e.key) {
                case 'ArrowDown':
                    this.state.focusIndex = Math.min(max, this.state.focusIndex + 1);
                    this.highlightFocusRow();
                    break;
                case 'ArrowUp':
                    this.state.focusIndex = Math.max(0, this.state.focusIndex - 1);
                    this.highlightFocusRow();
                    break;
                case 'Enter':
                case ' ':
                    this.playSong(this.state.focusIndex);
                    break;
            }
            if (e.code === 'MediaPlayPause') this.togglePlayPause();
            if (e.code === 'MediaTrackNext') this.nextSong();
            if (e.code === 'MediaTrackPrevious') this.prevSong();
        });
    }

    highlightFocusRow() {
        if (!this.songListEl) return;
        Array.from(this.songListEl.children).forEach(r => r.classList.remove('focused'));
        const row = this.songListEl.querySelector(`[data-index="${this.state.focusIndex}"]`);
        row?.classList.add('focused');
    }

    persistState() {
        localStorage.setItem('musicPlayerState', JSON.stringify({
            volume: this.state.volume,
            repeatMode: this.state.repeatMode,
            isShuffled: this.state.isShuffled,
            favorites: [...this.state.favorites],
            currentSong: this.state.currentIndex !== -1
                ? this.state.queue[this.state.currentIndex].id
                : null
        }));
    }

    restoreState() {
        const saved = localStorage.getItem('musicPlayerState');
        if (!saved) return;

        const s = JSON.parse(saved);
        this.state.repeatMode = s.repeatMode ?? 'off';
        this.state.isShuffled = !!s.isShuffled;
        this.state.favorites = new Set(s.favorites || []);

        if (s.currentSong) {
            const idxInQueue = this.state.queue.findIndex(x => x.id === s.currentSong);
            const idx = idxInQueue !== -1 ? idxInQueue : this.state.songs.findIndex(x => x.id === s.currentSong);
            if (idx !== -1) {
                this.state.currentIndex = idx;
                const song = this.state.queue[idx];
                this.audio.src = song.url;
                this.updateNowPlaying(song);
                this.highlightPlayingRow();
            }
        }
    }

    incrementPlayCount(id) {
        const counts = this.state.playCounts;
        counts[id] = (counts[id] || 0) + 1;
        localStorage.setItem('playCounts', JSON.stringify(counts));
        this.updateMostPlayedBadge();

        fetch(`${this.baseUrl}/api/play`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        }).catch(() => {});
    }

    updateMostPlayedBadge() {
        if (!this.mostPlayedEl) return;
        const entries = Object.entries(this.state.playCounts);
        if (!entries.length) { this.mostPlayedEl.textContent = '—'; return; }
        entries.sort((a, b) => b[1] - a[1]);
        const [topId, count] = entries[0];
        const song = this.state.songs.find(s => s.id === topId);
        this.mostPlayedEl.textContent = song ? `${song.title} — ${song.artist} (${count})` : '—';
    }

    updatePlayPauseButton() {
        if (!this.playPauseBtn) return;
        this.playPauseBtn.innerHTML = this.state.isPlaying
            ? `<i class="fas fa-pause"></i>`
            : `<i class="fas fa-play"></i>`;
    }

    updateNowPlaying(song) {
        if (this.npTitle) this.npTitle.textContent = song?.title || 'No song selected';
        if (this.npArtist) this.npArtist.textContent = song?.artist || '—';
        if (this.coverEl) {
            // keep previous interface, subtle glow via CSS; optional inline cover image if song.cover exists
            if (song?.cover) {
                this.coverEl.style.backgroundImage = `url('${song.cover}')`;
                this.coverEl.style.backgroundSize = 'cover';
                this.coverEl.style.backgroundPosition = 'center';
            } else {
                this.coverEl.style.backgroundImage = '';
            }
        }
    }
}

// Initialize once
document.addEventListener('DOMContentLoaded', () => {
    new MusicPlayer();
});
