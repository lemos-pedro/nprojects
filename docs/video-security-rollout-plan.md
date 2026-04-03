# Video + Security Rollout (10 dias para MVP)

## Objetivo
Entregar um MVP estável para reuniões com segurança operacional mínima e fluxo de pagamento validado.

## O que já está implementado
- Criação de reunião e token LiveKit por papel (`host`, `presenter`, `viewer`).
- Encerramento de reunião com webhook e resumo pós-reunião (com fallback).
- Integração inicial com billing Stripe (planos, checkout, webhook com assinatura).
- Proteções base:
  - autenticação no `project-service` (com token interno para serviço-serviço),
  - rate limiting por rota crítica,
  - validação de assinatura de webhook Stripe.
- Novos eventos Socket.io para reuniões:
  - `participant:hand_raised`
  - `meeting:reaction`
  - `meeting:spotlight`
  - `meeting:recording_status`
  - `meeting:mute_all`

## Prioridade MVP (entrar já)
1. Aviso legal de gravação (obrigatório):
- Banner fixo no frontend quando `meeting:recording_status` ou `meeting.isRecorded` ativo.
- Log de auditoria (quem ativou/desativou e quando).

2. Sala de espera:
- Tokens de `viewer` entram sem publicar.
- Host promove participante (admitir/publicar) via endpoint de controle.

3. Partilha de ecrã:
- Garantir permissão explícita no papel `presenter`.
- Teste com 2 participantes em simultâneo.

4. Chat durante reunião:
- Mapear `meetingId -> channelId` e mostrar chat do `communication-service` na UI da reunião.

5. Segurança operacional mínima:
- Rotação de secrets expostos.
- TLS obrigatório em produção (gateway + webhook endpoints).
- Alertas para 5xx e falhas de webhook Stripe/LiveKit.

## Pós-MVP (não bloquear lançamento)
- Breakout rooms.
- Transcrição em tempo real.
- Fundos virtuais.
- Notas colaborativas completas.
- Modo apresentação com regras avançadas de spotlight.

## Plano de execução (10 dias)
- Dia 1-2: Sala de espera + admitir participante + testes.
- Dia 3: Banner legal de gravação + auditoria simples.
- Dia 4: Screen share presenter + validação multi-device.
- Dia 5-6: Chat in-meeting integrado ao `communication-service`.
- Dia 7: Fechar webhook Stripe em produção (assinatura + persistência subscriptions/invoices).
- Dia 8: E2E completo (register/login -> projeto -> reunião -> checkout -> webhook).
- Dia 9: Hardening segurança (secrets, limites, logs, checklist deploy).
- Dia 10: Regression pass + release checklist.

## Critério de “MVP pronto”
- Fluxo reunião funcional entre 2 utilizadores:
  - entrar, levantar mão, reagir, partilhar ecrã, encerrar.
- Checkout Stripe cria sessão e webhook atualiza dados no banco.
- APIs críticas protegidas por auth + rate limit.
- Monitorização básica ativa para erros críticos.
