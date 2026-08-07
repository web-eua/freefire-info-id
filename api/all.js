const { parseProfileHtml } = require('./parser');

const BASE_URL = 'https://freefirejornal.com/perfil-jogador-freefire/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

module.exports = async (req, res) => {
  // CORS básico, para permitir uso via fetch no browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const id = (req.query && req.query.id) || null;

  if (!id) {
    res.status(400).json({
      success: false,
      error: 'Parâmetro "id" é obrigatório. Use ?id=SEU_ID_AQUI',
    });
    return;
  }

  if (!/^\d{4,20}$/.test(String(id))) {
    res.status(400).json({
      success: false,
      error: 'Parâmetro "id" inválido. Deve conter apenas números (4 a 20 dígitos).',
    });
    return;
  }

  const targetUrl = `${BASE_URL}${id}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });

    if (!response.ok) {
      res.status(response.status === 404 ? 404 : 502).json({
        success: false,
        error: `Falha ao buscar o perfil (status ${response.status}).`,
      });
      return;
    }

    const html = await response.text();
    const data = parseProfileHtml(html, String(id));

    if (!data.found) {
      res.status(404).json({
        success: false,
        error: 'Jogador não encontrado ou perfil indisponível.',
        id: String(id),
      });
      return;
    }

    res.status(200).json({
      success: true,
      source: targetUrl,
      fetchedAt: new Date().toISOString(),
      data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao processar a requisição.',
      details: String(err && err.message ? err.message : err),
    });
  }
};
