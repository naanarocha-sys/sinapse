# SINAPSE — party game pass & play

Jogo web mobile de "conexão neural": a Mente Brilhante vê o alvo escondido na onda entre dois polos, dá uma dica verbal e o time arrasta o pulso até onde acha que a dica aponta. Projeto separado do jogo de pesca (só mora na mesma pasta).

**Jogar / instalar no celular:** https://naanarocha-sys.github.io/sinapse/ (GitHub Pages, publica sozinho a cada push na `main`; troque o `CACHE` do `sw.js` a cada versão).

## Rodar

```
powershell -ExecutionPolicy Bypass -File servidor.ps1
```
Abrir http://localhost:8080 (no Chrome, F12 → modo celular para ver como no telefone).

## Arquivos

| Arquivo | O que tem |
|---|---|
| `index.html` | telas: menu, mesa (carta, canvas, polos, botões), loja simulada, como jogar, fim de jogo |
| `style.css` | visual neon (CSS puro: Tailwind via CDN quebraria o offline) |
| `app.js` | máquina de estados, onda no canvas, cérebros, partículas, áudio sintetizado, localStorage |
| `cards.js` | `FREE_CARDS` (30) e `PREMIUM_CARDS` (60 por enquanto; o botão anuncia +200) |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | PWA offline (rede primeiro, cache de reserva; trocar `CACHE` a cada versão publicada) |
| `servidor.ps1` | servidor local sem Python/Node |

## Regras no código (topo do `app.js`)

- O alvo é um ponto: a sinapse rompida na onda azul. O palpite é o pulso do time.
- `ZONE = [3.5, 13.5]`: o rompido no centro verde do pulso (até 3,5%) → 4 pontos; num braço amarelo (até 13,5%) → 2; fora → 0. As mesmas larguras pintam o pulso.
- Jogo pensado para o celular deitado (em pé aparece o aviso de girar). Régua de referência na onda em 25/50/75%.
- `WIN_SCORE = 10` (2 Times), `COOP_ROUNDS = 8` (Cooperativo).
- Interferência: +1 ao adversário se acertar o lado e o time não fizer 4.
- Salvos: `sinapse.save.v1` (partida) e `sinapse.settings.v1` (premium, som, modo).
- Teste no console: `SINAPSE.state`, `SINAPSE.scoreFor(d)`.

## Pendências

- 140 cartas premium para fechar as 200 anunciadas.
- Ícones PNG 192/512 para empacotar como APK (TWA/Bubblewrap); hoje só há `icon.svg`.
- Celular de verdade: o service worker exige https (ou localhost); pela rede local em http o jogo roda, mas sem modo offline.
