(function () {
  var searchInput = document.getElementById('coffee-search');
  var countEl = document.getElementById('coffee-count');
  var emptyEl = document.getElementById('coffee-empty');
  var gridEl = document.getElementById('coffee-grid');
  var noteFiltersEl = document.getElementById('coffee-note-filters');

  if (!searchInput || !gridEl) {
    return;
  }

  var cards = Array.prototype.slice.call(gridEl.querySelectorAll('.coffee-card'));
  var roastFilter = 'all';
  var brandFilter = 'all';
  var noteFilter = 'all';

  function slugify(text) {
    return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function buildNoteFilters() {
    if (!noteFiltersEl) {
      return;
    }

    var notes = {};

    cards.forEach(function (card) {
      card.querySelectorAll('.coffee-card__note').forEach(function (btn) {
        var value = btn.dataset.value;
        var label = btn.dataset.label || btn.textContent.trim();
        if (value) {
          notes[value] = label;
        }
      });
    });

    Object.keys(notes).sort(function (a, b) {
      return notes[a].localeCompare(notes[b]);
    }).forEach(function (value) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'coffee-filters__chip';
      chip.dataset.filter = 'note';
      chip.dataset.value = value;
      chip.textContent = notes[value];
      noteFiltersEl.appendChild(chip);
    });
  }

  function syncNoteHighlights() {
    document.querySelectorAll('.coffee-card__note').forEach(function (btn) {
      btn.classList.toggle('is-active', noteFilter !== 'all' && btn.dataset.value === noteFilter);
    });
  }

  function syncFilterChips() {
    document.querySelectorAll('.coffee-filters__chip').forEach(function (chip) {
      var filterType = chip.dataset.filter;
      var value = chip.dataset.value;

      if (filterType === 'roast') {
        chip.classList.toggle('is-active', value === roastFilter);
      }
      if (filterType === 'brand') {
        chip.classList.toggle('is-active', value === brandFilter);
      }
      if (filterType === 'note') {
        chip.classList.toggle('is-active', value === noteFilter);
      }
    });

    syncNoteHighlights();
  }

  function updateCount(visible) {
    if (countEl) {
      countEl.textContent = 'Showing ' + visible + ' of ' + cards.length + ' entries';
    }
    if (emptyEl) {
      emptyEl.hidden = visible > 0;
    }
  }

  function applyFilters() {
    var query = searchInput.value.trim().toLowerCase();
    var visible = 0;

    cards.forEach(function (card) {
      var searchBlob = card.dataset.search || '';
      var roast = card.dataset.roast || '';
      var brand = card.dataset.brand || '';
      var notes = (card.dataset.notes || '').split(',');

      var matchesSearch = !query || searchBlob.indexOf(query) !== -1;
      var matchesRoast = roastFilter === 'all' || roast === roastFilter;
      var matchesBrand = brandFilter === 'all' || brand === brandFilter;
      var matchesNote = noteFilter === 'all' || notes.indexOf(noteFilter) !== -1;

      var show = matchesSearch && matchesRoast && matchesBrand && matchesNote;
      card.hidden = !show;
      if (show) {
        visible += 1;
      }
    });

    syncFilterChips();
    updateCount(visible);
  }

  function setNoteFilter(value) {
    noteFilter = value || 'all';
    applyFilters();
  }

  function setBrandFilter(value) {
    brandFilter = value || 'all';
    applyFilters();
  }

  function handleChipClick(chip) {
    var filterType = chip.dataset.filter;
    var value = chip.dataset.value;

    if (filterType === 'roast') {
      roastFilter = value;
    }
    if (filterType === 'brand') {
      brandFilter = value;
    }
    if (filterType === 'note') {
      noteFilter = value;
    }

    applyFilters();
  }

  searchInput.addEventListener('input', applyFilters);

  document.addEventListener('click', function (event) {
    var chip = event.target.closest('.coffee-filters__chip');
    if (chip) {
      handleChipClick(chip);
      return;
    }

    var noteBtn = event.target.closest('.coffee-card__note');
    if (noteBtn && noteBtn.dataset.value) {
      event.preventDefault();
      noteFilter = noteFilter === noteBtn.dataset.value ? 'all' : noteBtn.dataset.value;
      applyFilters();
      return;
    }

    var brandBtn = event.target.closest('.coffee-card__brand');
    if (brandBtn && brandBtn.dataset.value) {
      event.preventDefault();
      brandFilter = brandFilter === brandBtn.dataset.value ? 'all' : brandBtn.dataset.value;
      applyFilters();
    }
  });

  buildNoteFilters();

  var params = new URLSearchParams(window.location.search);
  if (params.get('brand')) {
    brandFilter = slugify(params.get('brand'));
  }
  if (params.get('note')) {
    noteFilter = slugify(params.get('note'));
  }

  applyFilters();
})();
