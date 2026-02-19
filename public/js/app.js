const state = {
  page: 1,
  hasMore: true,
  loading: false,
  ads: [],
  adIndex: 0,
  append: false
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assetUrl(value) {
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `/uploads/${value}`;
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 1600);
}

function renderPost(post) {
  const shareUrl = `${window.location.origin}/?post=${post.id}`;
  const shareText = `Check this political promise by ${post.politician_name}`;
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent(shareText);
  const shareIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.24 1.02l-6.3-3.15a3.3 3.3 0 0 0 0-1.74l6.3-3.15A3 3 0 1 0 15 7a3 3 0 0 0 .1.75L8.8 10.9a3 3 0 1 0 0 2.2l6.3 3.15A3 3 0 1 0 18 16z"/></svg>`;
  const whatsappIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a9.8 9.8 0 0 0-8.5 14.7L2 22l5.4-1.4A9.8 9.8 0 1 0 12 2zm0 17.8a8 8 0 0 1-4.1-1.1l-.3-.2-3.2.8.9-3.1-.2-.3A8 8 0 1 1 12 19.8zm4.4-6.1c-.2-.1-1.2-.6-1.4-.7s-.3-.1-.5.1-.6.7-.8.8-.3.2-.6.1a6.5 6.5 0 0 1-2-1.2 7.2 7.2 0 0 1-1.3-1.6c-.1-.2 0-.3.1-.5l.4-.4c.1-.1.2-.2.3-.4l.1-.4c0-.1-.5-1.3-.7-1.8-.2-.4-.4-.4-.5-.4h-.4c-.2 0-.4 0-.6.2s-.8.7-.8 1.7.8 2 1 2.3 1.7 2.7 4.2 3.7c.6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.2-.5 1.4-1s.2-.9.1-1c-.1-.1-.2-.1-.4-.2z"/></svg>`;
  const facebookIcon = `<svg viewBox="-143 145 512 512" aria-hidden="true"><path d="M113,145c-141.4,0-256,114.6-256,256s114.6,256,256,256s256-114.6,256-256S254.4,145,113,145z M169.5,357.6l-2.9,38.3h-39.3v133H77.7v-133H51.2v-38.3h26.5v-25.7c0-11.3,0.3-28.8,8.5-39.7c8.7-11.5,20.6-19.3,41.1-19.3c33.4,0,47.4,4.8,47.4,4.8l-6.6,39.2c0,0-11-3.2-21.3-3.2c-10.3,0-19.5,3.7-19.5,14v29.9H169.5z"/></svg>`;
  const xIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 3h2.9l-6.4 7.3L23 21h-6l-4.7-6.2L6.8 21H3.9l6.8-7.8L1.5 3h6.2l4.2 5.6L18.9 3zm-1 16.3h1.7L6.8 4.6H5z"/></svg>`;
  const copyIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H10V7h9v14z"/></svg>`;

  return `
    <article class="post-card" data-post-id="${post.id}">
      <div class="post-head">
        <div class="meta meta-grid">
          <span class="identity">${post.politician_photo ? `<img src="${escapeHtml(assetUrl(post.politician_photo))}" alt="${escapeHtml(post.politician_name)}"/>` : ''}<a href="/politicians/${post.politician_id}">${escapeHtml(post.politician_name)}</a></span>
          ${post.party_id ? `<span class="identity">${post.party_logo ? `<img src="${escapeHtml(assetUrl(post.party_logo))}" alt="${escapeHtml(post.party_name)}"/>` : ''}<a href="/parties/${post.party_id}">${escapeHtml(post.party_name)}</a></span>` : '<span>Independent</span>'}
          <span class="location-badge">${escapeHtml(post.location || 'N/A')}</span>
        </div>
        <h3 class="post-title">${escapeHtml(post.promise_text)}</h3>
      </div>
      <div class="video-wrap">
        <video controls playsinline preload="metadata" src="${escapeHtml(assetUrl(post.video_path))}"></video>
      </div>
      <div class="actions">
        <button class="vote-up" data-action="vote" data-type="up" data-post-id="${post.id}" aria-label="Upvote post">गर्छ <span>${post.upvotes}</span></button>
        <button class="vote-down" data-action="vote" data-type="down" data-post-id="${post.id}" aria-label="Downvote post">गफाडी <span>${post.downvotes}</span></button>
        <button class="share-toggle-btn" data-action="share-toggle" data-post-id="${post.id}" aria-label="Share post">${shareIcon}<span>Share</span></button>
      </div>
      <div class="share-row" data-share-row="${post.id}">
        <a class="share-brand share-whatsapp" target="_blank" rel="noreferrer" href="https://wa.me/?text=${encodedText}%20${encodedUrl}" aria-label="Share on WhatsApp" title="WhatsApp">${whatsappIcon}</a>
        <a class="share-brand share-facebook" target="_blank" rel="noreferrer" href="https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}" aria-label="Share on Facebook" title="Facebook">${facebookIcon}</a>
        <a class="share-brand share-x" target="_blank" rel="noreferrer" href="https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}" aria-label="Share on X" title="X">${xIcon}</a>
        <button class="share-brand share-copy" data-action="copy" data-url="${escapeHtml(shareUrl)}" aria-label="Copy link" title="Copy link">${copyIcon}</button>
      </div>
    </article>`;
}

function renderAd(ad) {
  return `
    <article class="ad-card">
      <img src="${escapeHtml(assetUrl(ad.image_path))}" alt="${escapeHtml(ad.title)}" />
      <h3>${escapeHtml(ad.title)}</h3>
      <a class="btn-link" href="${escapeHtml(ad.contact_url)}" target="_blank" rel="noreferrer">Contact me</a>
    </article>`;
}

function updateLoadMoreButton() {
  const button = document.getElementById('load-more');
  if (!button) return;
  button.disabled = !state.hasMore || state.loading;
  button.textContent = state.loading ? 'Loading...' : state.hasMore ? 'Load more' : 'No more posts';
}

function setFilterPanelVisible(isVisible) {
  const panel = document.getElementById('filter-panel');
  const toggle = document.getElementById('toggle-filters');
  if (!panel || !toggle) return;
  panel.classList.toggle('is-collapsed', !isVisible);
  toggle.textContent = isVisible ? 'Hide Filters' : 'Show Filters';
}

async function loadFeed() {
  const feedEl = document.getElementById('feed');
  const stateEl = document.getElementById('feed-state');
  if (!feedEl || !stateEl || state.loading) return;

  state.loading = true;
  updateLoadMoreButton();

  const politician = document.getElementById('filter-politician')?.value || '';
  const party = document.getElementById('filter-party')?.value || '';
  const location = document.getElementById('filter-location')?.value || '';
  const textSearch = document.getElementById('filter-search')?.value || '';
  const sort = document.getElementById('filter-sort')?.value || 'trending';

  const query = new URLSearchParams({ sort, page: String(state.page), limit: '8' });
  if (politician) query.set('politician', politician);
  if (party) query.set('party', party);
  if (location) query.set('location', location);
  if (textSearch) query.set('q', textSearch);

  try {
    const response = await fetch(`/api/posts?${query.toString()}`);
    const data = await response.json();

    if (!state.append) {
      feedEl.innerHTML = '';
      state.ads = data.ads || [];
      state.adIndex = 0;
    }

    if (!data.posts.length && state.page === 1) {
      stateEl.textContent = 'No public records found for the selected filters.';
      state.hasMore = false;
      return;
    }

    const adInterval = 4;
    data.posts.forEach((post, idx) => {
      feedEl.insertAdjacentHTML('beforeend', renderPost(post));
      if ((idx + 1) % adInterval === 0 && state.ads.length) {
        const ad = state.ads[state.adIndex % state.ads.length];
        state.adIndex += 1;
        feedEl.insertAdjacentHTML('beforeend', renderAd(ad));
      }
    });

    state.hasMore = data.hasMore;
    stateEl.textContent = `Showing page ${data.page} of ${data.totalPages} (${data.total} accountability records)`;
  } catch (_err) {
    showToast('Failed to load posts', 'error');
  } finally {
    state.loading = false;
    updateLoadMoreButton();
  }
}

function resetFeedAndLoad() {
  state.page = 1;
  state.hasMore = true;
  state.append = false;
  loadFeed();
}

function clearFiltersAndLoad() {
  const politician = document.getElementById('filter-politician');
  const party = document.getElementById('filter-party');
  const location = document.getElementById('filter-location');
  const textSearch = document.getElementById('filter-search');
  const sort = document.getElementById('filter-sort');

  if (politician) politician.value = '';
  if (party) party.value = '';
  if (location) location.value = '';
  if (textSearch) textSearch.value = '';
  if (sort) sort.value = 'trending';

  resetFeedAndLoad();
}

async function sendVote(postId, voteType, button) {
  if (button) button.disabled = true;
  const response = await fetch('/api/votes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId, voteType })
  });

  const data = await response.json().catch(() => ({ message: 'Unable to vote right now' }));

  if (response.ok) {
    button?.classList.add('voted');
    const countEl = button?.querySelector('span');
    if (countEl) countEl.textContent = String(Number(countEl.textContent || '0') + 1);
    showToast(data.message || 'Vote added', 'success');
    setTimeout(() => {
      state.page = 1;
      state.append = false;
      state.hasMore = true;
      loadFeed();
    }, 400);
  } else {
    showToast(data.message || 'Vote failed', 'error');
    if (button) button.disabled = false;
  }
}

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.id === 'apply-filters') {
    resetFeedAndLoad();
    return;
  }

  if (target.id === 'toggle-filters') {
    const panel = document.getElementById('filter-panel');
    if (panel) setFilterPanelVisible(panel.classList.contains('is-collapsed'));
    return;
  }

  if (target.id === 'clear-filters') {
    clearFiltersAndLoad();
    return;
  }

  if (target.id === 'load-more') {
    if (!state.hasMore || state.loading) return;
    state.page += 1;
    state.append = true;
    loadFeed();
    return;
  }

  const action = target.getAttribute('data-action');
  if (!action) return;

  const postId = Number(target.getAttribute('data-post-id'));

  if (action === 'vote') {
    const voteType = target.getAttribute('data-type');
    if (voteType === 'up' || voteType === 'down') {
      sendVote(postId, voteType, target);
    }
    return;
  }

  if (action === 'share-toggle') {
    const row = document.querySelector(`[data-share-row="${postId}"]`);
    if (!row) return;
    row.classList.toggle('open');
    return;
  }

  if (action === 'copy') {
    const url = target.getAttribute('data-url') || '';
    await navigator.clipboard.writeText(url);
    showToast('Link copied', 'success');
  }
});

window.addEventListener('load', () => {
  setFilterPanelVisible(false);
  resetFeedAndLoad();
});
