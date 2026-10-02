# Publicar o app Hennder Vendas na Play Store

Preparado em 2026-10-01. O app é o próprio PWA do vendedor (`/vendedor.html`),
empacotado como app Android pela ferramenta oficial do Google (Bubblewrap, TWA).
Não existe código Android a manter: mudou o site, mudou o app.

## O que já está pronto

| Item | Onde |
|---|---|
| Pacote para enviar (`.aab`, assinado) | `C:\Tools\android\apps\hennder-vendas\app-release-bundle.aab` |
| APK para instalar direto num celular de teste | `C:\Tools\android\apps\hennder-vendas\app-release-signed.apk` |
| Chave de upload + senha | `C:\Tools\android\keys\` (**faça backup**: pendrive/Drive) |
| Imagem de destaque 1024×500 | `C:\Tools\android\apps\hennder-vendas\loja-destaque-1024x500.png` |
| Ícone 512×512 | `C:\Tools\android\apps\hennder-vendas\loja-icone-512.png` |
| Política de privacidade | `https://accounts.nexarcompany.com.br/privacidade.html` (`public/privacidade.html`) |
| Prova de dono do site | `https://accounts.nexarcompany.com.br/.well-known/assetlinks.json` (`public/.well-known/assetlinks.json`) |

- Nome do pacote: **`hennder_vendas.app`** (o app criado no Play Console ficou preso a esse nome; o `br.com.nexarcompany.vendas` planejado foi recusado em 02/10). É permanente.
- Versão: 1.0.0 (código 1). **Android mínimo: 7.0 (`minSdkVersion` 24)**: a Proteção Automática do Google Play recusa pacote com SDK mínimo abaixo de 24 (aconteceu no 1º envio, em 02/10).
- Java 17 e Android SDK ficam em `C:\Tools\android` (fora do repositório).

## Passo a passo no Play Console (feito pelo dono)

1. **Configurar o app** (painel → "Configure o app"): política de privacidade (endereço acima),
   acesso ao app, anúncios (**não tem**), classificação de conteúdo, público-alvo (**18+**, uso
   profissional), app de notícias (**não**), segurança dos dados (respostas abaixo) e categoria
   (**Empresa**).
2. **Acesso ao app:** o app exige login, então o revisor do Google precisa de um acesso de teste.
   Crie um vendedor só para isso na empresa de demonstração (Vendedores → acesso ao app) e informe
   no formulário: CNPJ da empresa, código e PIN, mais a instrução "Abra o app, digite CNPJ, código e PIN".
3. **Teste fechado (obrigatório na conta pessoal):** Teste → Teste fechado → criar faixa →
   enviar o `.aab` → adicionar **pelo menos 12 testadores** (e-mails de contas Google com Android) →
   publicar a faixa. Cada testador precisa **aceitar o convite pelo link** e manter o app instalado.
   O Google só libera "Produção" depois de **14 dias seguidos** com 12+ testadores.
4. **Feito em 02/10** (SHA-256 da chave do Google `35:8C:C8:FE:...:39:3E` já no `assetlinks.json`, junto com a de upload). **Depois do primeiro envio:** Configuração → Integridade do app → Assinatura do app → copie o
   **SHA-256 da chave de assinatura do app** (a do Google) e mande para incluir no
   `assetlinks.json`, junto da chave de upload que já está lá. Sem isso, o app instalado pela loja
   abre com a barra de endereço do navegador no topo (funciona, mas fica feio).
5. Depois dos 14 dias: Produção → criar versão → promover a mesma versão do teste fechado.

## Textos da ficha da loja

**Nome do app** (até 30): `Hennder Vendas`

**Descrição curta** (até 80): `Pedidos, orçamentos e clientes do seu ERP na palma da mão do vendedor externo.`

**Descrição completa:**

> O Hennder Vendas é o aplicativo do vendedor externo de empresas que usam o Hennder ERP.
>
> Na rua, no cliente ou na estrada, o vendedor:
> • consulta produtos, preços e estoque em tempo real;
> • cadastra e consulta clientes;
> • lança pedidos e orçamentos, que chegam na hora para a loja conferir e faturar;
> • acompanha os próprios pedidos;
> • solicita trocas de mercadoria.
>
> O acesso é liberado pela empresa: o vendedor entra com o CNPJ da empresa, o código de vendedor e o PIN.
> Sem anúncios e sem coleta de localização.
>
> Para usar, a empresa precisa ter o Hennder ERP com o acesso ao aplicativo contratado.

## Segurança dos dados (formulário do Google)

- O app coleta ou compartilha dados? **Sim, coleta.**
- Criptografia em trânsito? **Sim** (HTTPS).
- O usuário pode pedir exclusão? **Sim** (e-mail na política de privacidade).
- Dados coletados (todos **obrigatórios**, para **funcionalidade do app**, **não compartilhados** para publicidade):
  - Informações pessoais → **Nome**, **Endereço de e-mail**, **Endereço**, **Número de telefone**
    (dos clientes que o vendedor cadastra) e **IDs do usuário** (código do vendedor).
  - Informações financeiras → **Histórico de compras** (pedidos e orçamentos).
- **Não** coleta: localização, fotos/vídeos, áudio, contatos, histórico de navegação, identificadores de publicidade.

## Nova versão do app

Só é preciso gerar um novo `.aab` quando mudar o nome, o ícone ou a cor do app, ou quando o Google
exigir uma versão mais nova do Android. Mudança de tela não precisa: o app carrega o site.

1. Em `C:\Tools\android\apps\hennder-vendas\twa-manifest.json`, suba `appVersionCode` (2, 3...) e `appVersionName`.
2. O site de produção barra a ferramenta (anti-robô da Hostinger, erro 403). Por isso o
   `twa-manifest.json` aponta o ícone e o manifest para `http://127.0.0.1:8765/...`. Antes de gerar,
   sirva a pasta `public/` do repositório nessa porta (qualquer servidor estático).
3. Rode, nessa pasta, com `JAVA_HOME=C:\Tools\android\jdk-17.0.20.1+1` e o `bin` dele no PATH:
   `npx @bubblewrap/cli update --skipVersionUpgrade` e `npx @bubblewrap/cli build --skipPwaValidation`.
   A senha da chave vai nas variáveis `BUBBLEWRAP_KEYSTORE_PASSWORD` e `BUBBLEWRAP_KEY_PASSWORD`
   (está em `C:\Tools\android\keys\hennder-vendas-upload-SENHA.txt`). Nunca deixe a senha aparecer em log.
4. Neste ambiente o Windows não procura programas na pasta atual (`NoDefaultCurrentDirectoryInExePath`):
   remova essa variável na sessão antes do `build`, ou o `gradlew.bat` não é encontrado.
