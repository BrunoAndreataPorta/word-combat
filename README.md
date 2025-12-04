# 🧩 Word Combat

Projeto final do curso de **Análise e Desenvolvimento de Sistemas** da **FATEC Mogi Mirim – Arthur de Azevedo**.


Word Combat é um jogo multiplayer de palavras-cruzadas competitivo, onde os jogadores disputam para completar o tabuleiro antes do tempo acabar. O jogo utiliza IA generativa (Google Gemini) para criar palavras e dicas exclusivas, tornando cada partida única.



---

## 📦 Estrutura do Projeto


```
word-combat/
├── .gitignore
├── README.md
├── server/
│   ├── .env
│   ├── index.js
│   ├── package.json
│   └── package-lock.json
└── client/
    ├── auth.html
    ├── hub.html
    ├── index.html
    ├── lobby.html
    └── js/
        ├── auth.js
        └── game.js
        └── hub.js
        └── leave.js
        └── lobby.js
        └── main.js
        └── profile.js
    └── css/
        ├── auth.css
        └── hub.css
        └── lobby.css
        └── style.css
        └── ui.css


```


---

## 🚀 Como testar o projeto

1. Clone o repositório ou baixe o projeto:
   ```bash
   git clone https://github.com/BrunoAndreataPorta/word-combat.git
   cd word-combat/server
   
2. Instale as dependências:
   ```bash
   npm install

3. Inicie o servidor:
   ```bash
   node index.js

4. Abra o jogo no navegador:
   ```bash
   http://localhost:3000

⚙️ Arquivo .env

Antes de iniciar o servidor, crie um arquivo chamado .env dentro da pasta server/ com o seguinte conteúdo:
    
    ```bash
    # Banco de dados (ajuste conforme seu ambiente)
    DB_HOST=localhost
    DB_USER=root
    DB_PASS=root
    DB_NAME=wordcombat
    
    # JWT (autenticação)
    JWT_SECRET=dev_secret
    JWT_EXPIRES=7d
    
    # API de geração de palavras (Google Gemini)
    GENAI_API_KEY=SUA_CHAVE_AQUI

🧠 Tecnologias utilizadas  
**Backend**
Node.js  
Express  
Socket.io  
MySQL  
JWT  
bcryptjs    

**IA**  
Google Gemini (Geração de palavras e dicas temáticas)  
  
**Frontend**  
HTML5  
CSS3  
JavaScript (puro)  
