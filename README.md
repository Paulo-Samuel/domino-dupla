# Dominó em Dupla 🁫

Dominó em dupla para 4 jogadores, no iPhone e no Android:

- **Contra o computador** — você e sua dupla contra dois robôs (funciona offline).
- **Online** — 4 amigos, cada um no seu celular. Lugares vazios podem ser preenchidos com robôs.

É um web app instalável (PWA): sem App Store, sem conta de desenvolvedor.

## Instalar no celular

- **iPhone:** abra o link no **Safari** → **Compartilhar** → **Adicionar à Tela de Início**.
- **Android:** abra o link no **Chrome** → menu ⋮ → **Instalar app** (ou *Adicionar à tela inicial*).

Abra pelo ícone: ele roda em tela cheia, como um app.

## Jogar online

1. Um jogador (o **anfitrião**) toca em **Criar sala online** e recebe um código de 5 letras.
2. Ele toca em **Convidar amigos** e manda o link pelo WhatsApp — ou os amigos digitam o código em **Entrar**.
3. Cada um escolhe um lugar. Parceiros ficam frente a frente: lugares 1 e 3 contra 2 e 4. O anfitrião pode pôr robôs nos lugares vazios.
4. O anfitrião toca em **Começar partida**.

Bom saber:

- O jogo roda no aparelho do anfitrião. **Ele deve manter o app aberto** (a tela fica acesa sozinha); se sair, a mesa pausa até ele voltar.
- Se alguém cair da internet, depois de uns 20 segundos um robô joga por ele até ele voltar.
- As mensagens passam por um servidor MQTT público e gratuito (EMQX, HiveMQ ou Mosquitto, conforme o código da sala). As pedras de cada jogador vão criptografadas (ECDH + AES-GCM), então quem espiar o servidor não vê a mão de ninguém. Por ser um serviço gratuito, não há garantia de disponibilidade.

## Regras

- 28 pedras (duplo-seis), 7 para cada jogador, sem monte.
- Ninguém recebe mais de **4 buchas**: com 5 ou mais, as pedras são embaralhadas de novo.
- A primeira rodada começa com quem tem a **bucha de sena (6|6)**; nas seguintes, a **dupla que venceu sai**: qualquer um dos dois parceiros joga a primeira pedra, com qualquer pedra (ou deixa o parceiro sair).
- A vez passa para a direita. Sem pedra que sirva, o jogador passa.
- Pontos de quem bate (fica sem pedras):
  - batida simples — 1
  - de bucha (última pedra é dobrada) — 2
  - nas duas pontas (pedra comum que encaixa nas duas pontas, ex.: pontas 3 e 5, bate com 3|5) — 2
  - gambuada (bucha que serve nas duas pontas) — 4
- **Jogo trancado**: a dupla com menos pontos na mão ganha 1 ponto; empate não pontua.
- Vence a dupla que chegar a **4 pontos**.

## Modo teste (administrador)

Para ligar o modo administrador, **toque 5 vezes seguidas no ícone da tela inicial** do jogo (toque 5 vezes de novo para desligar). Também dá para abrir o site com `?teste=1` no fim do endereço; `?teste=0` desliga. No iPhone, o app instalado na Tela de Início não enxerga o que foi ligado pelo Safari, então use o toque no ícone. Com ele ligado, o menu ☰ ganha **🧪 Escolher minhas pedras**: você escolhe até 7 pedras (no máximo 4 buchas), o resto é sorteado e a rodada recomeça sem pontuar a anterior. A nova rodada vale pontos normalmente e não aparece nenhum aviso para os outros jogadores. Funciona contra o computador e, no online, só para o anfitrião (também na sala de espera, valendo para a primeira rodada).

## Publicar (GitHub Pages)

O jogo mora na pasta `domino-dupla/` do repositório Wand-Enhancer e é publicado pelo workflow `.github/workflows/domino-dupla.yml`:

1. Em **Settings → Pages**, escolha *Source: GitHub Actions*.
2. A cada push na `master` que mexa em `domino-dupla/`, os testes rodam e o site é publicado em `https://paulo-samuel.github.io/Wand-Enhancer/`.

## Desenvolvimento

Sem dependências nem build: HTML, CSS e JavaScript (módulos ES).

```bash
npm start   # servidor local em http://localhost:8080
npm test    # regras, motor, IA e layout da mesa (node --test)
```

| Arquivo | Conteúdo |
| --- | --- |
| `js/game.js` | Regras puras: distribuição, jogadas, passes, batidas, trancamento e placar |
| `js/engine.js` | Conduz a partida (vez, robôs, quem caiu) e gera o que cada lugar pode ver |
| `js/ai.js` | Jogadores automáticos (só usam informação que um jogador real teria) |
| `js/online.js` | Salas online: anfitrião, convidados e criptografia das mãos |
| `js/mqtt-lite.js` | Cliente MQTT mínimo sobre WebSocket |
| `js/board.js` | Layout da mesa em "cobra" e desenho das pedras em SVG |
| `js/app.js` | Interface, turnos, som e salvamento |
| `sw.js` | Cache offline — aumente a versão `CACHE` ao alterar arquivos |

Para testar o online sem internet, rode um servidor MQTT com WebSocket local (ex.: Mosquitto ou Aedes) e abra `http://localhost:8080/?broker=ws://localhost:1884` em várias abas.
