export const catalogProducts = [
  {name: 'Alpine GT', specs: '225/45 R20 · Directional winter tread', price: 219, rimColor: 0xb8a06a},
  {name: 'Glacier Sport', specs: '245/40 R19 · High-density sipes', price: 249, rimColor: 0xb9c9df},
  {name: 'Polar Touring', specs: '215/55 R17 · Deep snow channels', price: 189, rimColor: 0x545d70},
];

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function mountCatalog({onMove, onPause, onBack, onPreview}) {
  const app = document.getElementById('app');
  const catalog = app.querySelector('.wheel-catalog');
  const name = document.getElementById('catalog-name');
  const specs = document.getElementById('catalog-specs');
  const price = document.getElementById('catalog-price');
  const previous = document.getElementById('catalog-prev');
  const next = document.getElementById('catalog-next');
  const pause = document.getElementById('catalog-pause');
  const order = document.getElementById('catalog-order');
  const dialog = document.getElementById('catalog-order-dialog');
  const preview = document.getElementById('catalog-order-wheel');
  const orderName = document.getElementById('catalog-order-name');
  const orderSpecs = document.getElementById('catalog-order-specs');
  const orderPrice = document.getElementById('catalog-order-price');
  const orderTotal = document.getElementById('catalog-order-total');
  const quantity = document.getElementById('catalog-quantity');
  const status = document.getElementById('catalog-order-status');
  const summary = document.getElementById('catalog-order-summary');
  let index = 0;
  let paused = false;
  let moving = false;

  function select(newIndex) {
    index = newIndex;
    const product = catalogProducts[index];
    name.textContent = product.name;
    specs.textContent = product.specs;
    price.textContent = dollars.format(product.price);
  }

  function setMoving(value) {
    moving = value;
    catalog.classList.toggle('catalog-moving', value);
    order.disabled = value;
  }

  function setPaused(value) {
    paused = value;
    pause.textContent = paused ? 'Resume autoplay' : 'Pause autoplay';
    onPause(paused || dialog.open);
  }

  function updateOrder() {
    const product = catalogProducts[index];
    const count = Number(quantity.value);
    const total = dollars.format(product.price * count);
    orderTotal.textContent = `${total} USD`;
    summary.value = [
      `Northgrip ${product.name}`,
      product.specs,
      `Quantity: ${count}`,
      `Demo total: ${total} USD`,
    ].join('\n');
    status.textContent = '';
  }

  previous.addEventListener('click', () => onMove(-1));
  next.addEventListener('click', () => onMove(1));
  pause.addEventListener('click', () => setPaused(!paused));
  document.getElementById('catalog-back').addEventListener('click', onBack);

  order.addEventListener('click', () => {
    if (moving) return;
    const product = catalogProducts[index];
    orderName.textContent = product.name;
    orderSpecs.textContent = product.specs;
    orderPrice.textContent = dollars.format(product.price);
    quantity.value = '1';
    summary.hidden = true;
    updateOrder();
    dialog.showModal();
    onPause(true);
    onPreview(preview, index);
  });

  quantity.addEventListener('change', updateOrder);
  dialog.addEventListener('close', () => onPause(paused));
  document.getElementById('catalog-copy-order').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(summary.value);
      status.textContent = 'Order details copied.';
    } catch {
      summary.hidden = false;
      summary.focus();
      summary.select();
      status.textContent = 'Details selected. Copy them with Ctrl+C or ⌘C.';
    }
  });

  window.addEventListener('keydown', (event) => {
    if (app.dataset.stage !== 'catalog' || dialog.open || event.defaultPrevented) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onMove(event.key === 'ArrowLeft' ? -1 : 1);
  });

  return {select, setMoving, setPaused};
}
