const https = require('https');

// ---------- Helpers de texto (mesmo estilo do id.js original) ----------

function cleanText(text) {
    if (text === null || text === undefined) return null;
    const t = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/&#8211;/g, '-')
        .replace(/&#038;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (t === '' || /^n[ãa]o informado$/i.test(t)) return null;
    return t;
}

// "1.886.444" -> 1886444 | "8,38" -> 8.38
function toNumber(str) {
    if (str === null || str === undefined) return null;
    const s = String(str).trim();
    if (s === '' || /^n[ãa]o informado$/i.test(s)) return null;
    const cleaned = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
}

function toPercent(str) {
    if (!str) return null;
    const m = String(str).match(/([\d.,]+)\s*%/);
    return m ? toNumber(m[1]) : null;
}

function parseYesNo(str) {
    if (str === null || str === undefined) return null;
    const s = String(str).trim().toLowerCase();
    if (s === 'sim') return true;
    if (s === 'não' || s === 'nao') return false;
    return cleanText(str);
}

function slugify(str) {
    return String(str)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

// Extrai pares "<div><span>label</span><strong>value</strong></div>"
function extractLabelValuePairs(html) {
    const pairs = [];
    const re = /<div[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<strong[^>]*>([\s\S]*?)<\/strong>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        pairs.push({ label: cleanText(m[1]), value: cleanText(m[2]) });
    }
    return pairs;
}

// Pega o trecho "jgff-details-grid" logo após um heading com o id informado
function extractDetailsGridAfter(html, anchorId) {
    const idx = html.indexOf(`id="${anchorId}"`);
    if (idx === -1) return null;
    const start = html.indexOf('<div class="jgff-details-grid">', idx);
    if (start === -1) return null;
    const end = html.indexOf('</section>', start);
    if (end === -1) return null;
    return html.slice(start, end);
}

// ---------- Requisição HTTP (mesmo estilo do id.js original) ----------

async function fetchPlayerData(playerId) {
    return new Promise((resolve, reject) => {
        const url = `https://freefirejornal.com/perfil-jogador-freefire/${playerId}/`;

        const options = {
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9',
                'Cache-Control': 'max-age=0',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
            }
        };

        https.get(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Perfil não encontrado (status ${res.statusCode})`));
                    return;
                }
                resolve(data);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// ---------- Extração completa do perfil ----------

function extractProfile(html, playerId) {
    const data = {
        id: playerId,
        found: false,
        nickname: null,
        avatarUrl: null,
        level: null,
        xp: null,
        likes: null,
        region: null,
        lastOnline: null,
        profileUpdatedAt: null,
        profileViews: null,
        account: {
            createdAt: null,
            lastLogin: null,
            gameVersion: null,
            accountType: null,
            linkedAccount: null,
            season: null,
            badges: null,
            elitePass: null,
            influencer: null,
            emulator: null
        },
        guild: {
            name: null,
            clanId: null,
            emblem: null,
            championshipTeam: null,
            teamId: null,
            teamMembers: null
        },
        prime: {
            level: null,
            monthlyPoints: null,
            annualPoints: null,
            totalPoints: null
        },
        extra: {
            csPeakPoints: null,
            hippoRank: null,
            hippoPoints: null
        },
        flags: {
            activeMember: null,
            csRankBan: null,
            homepagePenalized: null,
            accountDeleted: null
        },
        ranks: {},
        // Todos os itens/skins equipados, com o link direto da imagem de cada um
        items: [],
        stats: {
            totals: { matches: null, wins: null, kills: null },
            modes: {}
        }
    };

    if (!html.includes('data-jgff-profile')) {
        return data; // jogador não encontrado / bloco de perfil ausente
    }

    // ---- Nickname e avatar ----
    const nickMatch = html.match(/<div class="jgff-profile-identity">[\s\S]*?<h2>([\s\S]*?)<\/h2>/);
    data.nickname = nickMatch ? cleanText(nickMatch[1]) : null;

    const avatarMatch = html.match(/<img class="jgff-avatar" src="([^"]+)"/);
    data.avatarUrl = avatarMatch ? avatarMatch[1] : null;

    const levelBadgeMatch = html.match(/<span class="jgff-level-badge">([\s\S]*?)<\/span>/);
    if (levelBadgeMatch) {
        const m = cleanText(levelBadgeMatch[1]).match(/(\d+)/);
        if (m) data.level = parseInt(m[1], 10);
    }

    // ---- Fatos rápidos do card (ID / Região / Última vez online / Atualizado em) ----
    const factsBlockMatch = html.match(/<div class="jgff-profile-facts">([\s\S]*?)<\/section>/);
    const factsHtml = factsBlockMatch ? factsBlockMatch[1] : '';
    const factRe = /<div><span>([\s\S]*?)<\/span><strong>([\s\S]*?)<\/strong>/g;
    let fm;
    while ((fm = factRe.exec(factsHtml)) !== null) {
        const label = cleanText(fm[1]);
        const value = cleanText(fm[2]);
        if (!label) continue;
        const l = label.toLowerCase();
        if (l.includes('id do jogador')) data.id = value || data.id;
        else if (l.includes('regi')) data.region = value;
        else if (l.includes('última vez online') || l.includes('ultima vez online')) data.lastOnline = value;
        else if (l.startsWith('atualizado em')) {
            data.profileUpdatedAt = label.replace(/^atualizado em\s*/i, '').trim();
            const viewsMatch = value && value.match(/(\d+)/);
            data.profileViews = viewsMatch ? parseInt(viewsMatch[1], 10) : toNumber(value);
        }
    }

    // ---- Visão geral (Nível / Experiência / Likes / Guilda) ----
    const overviewMatch = html.match(/<div class="jgff-summary-grid">([\s\S]*?)<div class="jgff-ranks-grid">/);
    if (overviewMatch) {
        for (const { label, value } of extractLabelValuePairs(overviewMatch[1])) {
            if (!label) continue;
            const l = label.toLowerCase();
            if (l === 'nível' || l === 'nivel') data.level = toNumber(value) ?? data.level;
            else if (l === 'experiência' || l === 'experiencia') data.xp = toNumber(value);
            else if (l === 'likes') data.likes = toNumber(value);
            else if (l === 'guilda') data.guild.name = value;
        }
    }

    // ---- Prime ----
    const primeMatch = html.match(/id="jgff-prime-title"[\s\S]*?<div class="jgff-summary-grid">([\s\S]*?)<\/section>/);
    if (primeMatch) {
        for (const { label, value } of extractLabelValuePairs(primeMatch[1])) {
            if (!label) continue;
            const l = label.toLowerCase();
            if (l.includes('nível prime') || l.includes('nivel prime')) data.prime.level = toNumber(value);
            else if (l.includes('pontos mensais')) data.prime.monthlyPoints = toNumber(value);
            else if (l.includes('pontos anuais')) data.prime.annualPoints = toNumber(value);
            else if (l.includes('pontos totais')) data.prime.totalPoints = toNumber(value);
        }
    }

    // ---- Ranques (BR / CS / outros) ----
    const ranksBlockMatch = html.match(/<div class="jgff-ranks-grid">([\s\S]*?)<\/section>/);
    if (ranksBlockMatch) {
        const rankCardRe = /<article class="jgff-rank-card[^"]*">([\s\S]*?)<\/article>/g;
        let rc, idx = 0;
        while ((rc = rankCardRe.exec(ranksBlockMatch[1])) !== null) {
            const cardHtml = rc[1];
            const headingMatch = cardHtml.match(/<div class="jgff-rank-heading"><span>([\s\S]*?)<\/span><strong>([\s\S]*?)<\/strong>/);
            const label = headingMatch ? cleanText(headingMatch[1]) : null;
            const rankStr = headingMatch ? cleanText(headingMatch[2]) : null;
            const rankNum = rankStr ? toNumber((rankStr.match(/(\d+)/) || [])[1]) : null;

            const entry = { rank: rankNum, points: null, bestRank: null, bestPosition: null };
            const rowRe = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;
            let dm;
            while ((dm = rowRe.exec(cardHtml)) !== null) {
                const dt = cleanText(dm[1]).toLowerCase();
                const dd = cleanText(dm[2]);
                if (dt.includes('pontos')) entry.points = toNumber(dd);
                else if (dt.includes('melhor rank')) entry.bestRank = toNumber(dd);
                else if (dt.includes('melhor posi')) entry.bestPosition = dd;
            }

            const key = label ? slugify(label) : `rank_${idx}`;
            data.ranks[key] = { label, ...entry };
            idx++;
        }
    }

    // ---- Itens e skins equipados (nome, categoria, raridade, versão e LINK DA IMAGEM) ----
    const itemsBlockMatch = html.match(/<div class="jgff-items-grid">([\s\S]*?)<\/section>/);
    if (itemsBlockMatch) {
        const itemCardRe = /<article class="jgff-item-card">([\s\S]*?)<\/article>/g;
        let ic;
        while ((ic = itemCardRe.exec(itemsBlockMatch[1])) !== null) {
            const cardHtml = ic[1];
            const urlMatch = cardHtml.match(/<a class="jgff-item-link" href="([^"]+)"/);
            const imgMatch = cardHtml.match(/<div class="jgff-item-image"><img src="([^"]+)"/);
            const categoryMatch = cardHtml.match(/<span class="jgff-item-category">([\s\S]*?)<\/span>/);
            const nameMatch = cardHtml.match(/<h3>([\s\S]*?)<\/h3>/);
            const metaMatch = cardHtml.match(/<div class="jgff-item-meta">([\s\S]*?)<\/div>/);
            let metaSpans = [];
            if (metaMatch) {
                const spanRe = /<span>([\s\S]*?)<\/span>/g;
                let sm;
                while ((sm = spanRe.exec(metaMatch[1])) !== null) metaSpans.push(cleanText(sm[1]));
            }
            data.items.push({
                name: nameMatch ? cleanText(nameMatch[1]) : null,
                category: categoryMatch ? cleanText(categoryMatch[1]) : null,
                itemId: metaSpans[0] ? metaSpans[0].replace('#', '') : null,
                rarity: metaSpans[1] || null,
                version: metaSpans[2] || null,
                imageUrl: imgMatch ? imgMatch[1] : null,
                wikiUrl: urlMatch ? urlMatch[1] : null
            });
        }
    }

    // ---- Totais de partidas (resumo em texto) ----
    const statsIntroMatch = html.match(/id="jgff-stats-title"[\s\S]*?<div class="jgff-section-copy">([\s\S]*?)<div class="jgff-chart-card">/);
    if (statsIntroMatch) {
        const totalsMatch = statsIntroMatch[1].match(/([\d.,]+)\s*partidas[\s\S]*?([\d.,]+)\s*vit[óo]rias[\s\S]*?([\d.,]+)\s*abates/i);
        if (totalsMatch) {
            data.stats.totals.matches = toNumber(totalsMatch[1]);
            data.stats.totals.wins = toNumber(totalsMatch[2]);
            data.stats.totals.kills = toNumber(totalsMatch[3]);
        }
    }

    // ---- Estatísticas por modo (Solo / Duo / Squad) ----
    const modeGridMatch = html.match(/<div class="jgff-mode-grid">([\s\S]*?)<\/section>/);
    if (modeGridMatch) {
        const modeCardRe = /<article class="jgff-mode-card[^"]*">([\s\S]*?)<\/article>/g;
        let mc, idx = 0;
        while ((mc = modeCardRe.exec(modeGridMatch[1])) !== null) {
            const cardHtml = mc[1];
            const headerMatch = cardHtml.match(/<header><span>([\s\S]*?)<\/span><strong>([\s\S]*?)<small>([\s\S]*?)<\/small><\/strong><\/header>/);
            const modeLabel = headerMatch ? cleanText(headerMatch[1]) : null;
            const matches = headerMatch ? toNumber(cleanText(headerMatch[2])) : null;

            const mode = {
                label: modeLabel,
                matches,
                wins: null,
                winRate: null,
                kills: null,
                killDeathRatio: null,
                headshotSurvivalRate: null,
                headshotSurvivalCount: null,
                details: {}
            };

            const highlightsMatch = cardHtml.match(/<div class="jgff-mode-highlights">([\s\S]*?)<\/div>\s*<dl/);
            if (highlightsMatch) {
                const rowRe = /<div><span>([\s\S]*?)<\/span><strong>([\s\S]*?)<\/strong><small>([\s\S]*?)<\/small><\/div>/g;
                let rm;
                while ((rm = rowRe.exec(highlightsMatch[1])) !== null) {
                    const label = cleanText(rm[1]).toLowerCase();
                    const value = cleanText(rm[2]);
                    const small = cleanText(rm[3]);
                    if (label.includes('vitórias') || label.includes('vitorias')) {
                        mode.wins = toNumber(value);
                        mode.winRate = toPercent(small);
                    } else if (label.includes('abates')) {
                        mode.kills = toNumber(value);
                        const kdMatch = small && small.match(/([\d.,]+)/);
                        mode.killDeathRatio = kdMatch ? toNumber(kdMatch[1]) : null;
                    } else if (label.includes('taxa de capa')) {
                        mode.headshotSurvivalRate = toPercent(value);
                        mode.headshotSurvivalCount = toNumber(small);
                    }
                }
            }

            const statListMatch = cardHtml.match(/<dl class="jgff-stat-list">([\s\S]*?)<\/dl>/);
            if (statListMatch) {
                const rowRe = /<div>\s*<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>\s*<\/div>/g;
                let dm;
                while ((dm = rowRe.exec(statListMatch[1])) !== null) {
                    const dt = cleanText(dm[1]);
                    const rawDd = dm[2];
                    const smallMatch = rawDd.match(/<small>([\s\S]*?)<\/small>/);
                    const ddSmall = smallMatch ? cleanText(smallMatch[1]) : null;
                    const ddMain = cleanText(rawDd.replace(/<small>[\s\S]*?<\/small>/, ''));
                    if (!dt) continue;
                    const key = slugify(dt);
                    mode.details[key] = {
                        label: dt,
                        value: ddMain,
                        numeric: toNumber(ddMain),
                        extra: ddSmall
                    };
                }
            }

            const key = modeLabel ? modeLabel.toLowerCase() : `mode_${idx}`;
            data.stats.modes[key] = mode;
            idx++;
        }
    }

    // ---- Detalhes da conta ----
    const accountHtml = extractDetailsGridAfter(html, 'jgff-account-title');
    if (accountHtml) {
        for (const { label, value } of extractLabelValuePairs(accountHtml)) {
            if (!label) continue;
            const l = label.toLowerCase();
            if (l.includes('conta criada')) data.account.createdAt = value;
            else if (l.includes('último login') || l.includes('ultimo login')) data.account.lastLogin = value;
            else if (l.includes('versão do jogo') || l.includes('versao do jogo')) data.account.gameVersion = value;
            else if (l.includes('tipo da conta')) data.account.accountType = value;
            else if (l.includes('conta vinculada')) data.account.linkedAccount = value;
            else if (l.includes('temporada')) data.account.season = toNumber(value) ?? value;
            else if (l.includes('insígnias') || l.includes('insignias')) data.account.badges = toNumber(value);
            else if (l.includes('passe elite')) data.account.elitePass = parseYesNo(value);
            else if (l.includes('influenciador')) data.account.influencer = parseYesNo(value);
            else if (l.includes('emulador')) data.account.emulator = parseYesNo(value);
        }
    }

    // ---- Guilda, clã e equipe ----
    const clanHtml = extractDetailsGridAfter(html, 'jgff-clan-title');
    if (clanHtml) {
        for (const { label, value } of extractLabelValuePairs(clanHtml)) {
            if (!label) continue;
            const l = label.toLowerCase();
            if (l === 'guilda') data.guild.name = value;
            else if (l.includes('id do clã') || l.includes('id do cla')) data.guild.clanId = value;
            else if (l.includes('emblema do clã') || l.includes('emblema do cla')) data.guild.emblem = value;
            else if (l.includes('equipe de campeonato')) data.guild.championshipTeam = value;
            else if (l.includes('id da equipe')) data.guild.teamId = value;
            else if (l.includes('membros da equipe')) data.guild.teamMembers = toNumber(value);
        }
    }

    // ---- Indicadores adicionais ----
    const extraHtml = extractDetailsGridAfter(html, 'jgff-extra-title');
    if (extraHtml) {
        for (const { label, value } of extractLabelValuePairs(extraHtml)) {
            if (!label) continue;
            const l = label.toLowerCase();
            if (l.includes('pico de pontos cs')) data.extra.csPeakPoints = toNumber(value);
            else if (l.includes('hippo rank')) data.extra.hippoRank = toNumber(value);
            else if (l.includes('pontos hippo')) data.extra.hippoPoints = toNumber(value);
        }
    }

    // ---- Flags de status ----
    const flagsBlockMatch = html.match(/<section class="jgff-flags"[^>]*>([\s\S]*?)<\/section>/);
    if (flagsBlockMatch) {
        const spanRe = /<span[^>]*>([\s\S]*?)<\/span>/g;
        let sm;
        while ((sm = spanRe.exec(flagsBlockMatch[1])) !== null) {
            const txt = cleanText(sm[1]);
            if (!txt || !txt.includes(':')) continue;
            const sepIdx = txt.indexOf(':');
            const labelPart = txt.slice(0, sepIdx).trim();
            const valuePart = txt.slice(sepIdx + 1).trim();
            const l = labelPart.toLowerCase();
            const val = parseYesNo(valuePart);
            if (l.includes('membro ativo')) data.flags.activeMember = val;
            else if (l.includes('banimento ranqueado cs')) data.flags.csRankBan = val;
            else if (l.includes('página inicial penalizada') || l.includes('pagina inicial penalizada')) data.flags.homepagePenalized = val;
            else if (l.includes('conta excluída') || l.includes('conta excluida')) data.flags.accountDeleted = val;
        }
    }

    data.found = true;
    return data;
}

// ---------- Handler da rota (mesmo estilo do id.js original) ----------

module.exports = async (req, res) => {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // Verificar método
    if (req.method !== 'GET') {
        return res.status(405).json({
            success: false,
            error: 'Método não permitido'
        });
    }

    const playerId = req.query.id;

    if (!playerId) {
        return res.status(400).json({
            success: false,
            error: 'ID do jogador não fornecido, use ?id=xxxxxxxx'
        });
    }

    if (!/^\d+$/.test(playerId)) {
        return res.status(400).json({
            success: false,
            error: 'ID inválido'
        });
    }

    try {
        const html = await fetchPlayerData(playerId);
        const perfil = extractProfile(html, playerId);

        if (!perfil.found) {
            return res.status(404).json({
                success: false,
                error: 'Perfil não encontrado ou indisponível'
            });
        }

        return res.status(200).json({
            success: true,
            data: perfil
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || 'Erro ao processar dados'
        });
    }
};
