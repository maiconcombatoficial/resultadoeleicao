# Scripts de dados

Geram os arquivos estáticos do app a partir dos dados públicos do TSE. Precisam de Python 3 com `asn1tools` e `cryptography` (`pip install asn1tools cryptography`). Os downloads ficam em `.cache/`, que não vai para o git.

| Script | O que faz |
|---|---|
| `atualizar.py --turno 2` | Faz tudo para um turno: baixa os boletins, gera os bairros e, com `PRO_SENHA` ou `PRO_CHAVE`, refaz a área protegida. É o que o workflow `.github/workflows/boletins.yml` roda. |
| `baixar_boletins.py --turno N` | Baixa o boletim de urna (BU) de cada seção de SC do pleito do TSE (`arquivo-urna/<pleito>`). |
| `gerar_bairros.py --ano 2026 --turno N --pleito P` | Decodifica os BU (especificação ASN.1 do TSE em `spec/bu.asn1`), grava `dados2026/secoes/<cd>.json`, `dados2026/bairros-<eleição>.json` e `dados2026/indice.json`, com o bairro de cada local pelo cadastro de locais do TSE (Florianópolis: lista do TRE-SC). |
| `gerar_pro.py` | Gera e criptografa `pro/*.bin` (mapa, perfil do eleitor, abstenção, transferência entre turnos). Com `--usuario NOME --senha-nova SENHA`, cadastra outro usuário. |
| `transferencia.py` | Estimativa de transferência de votos entre turnos (mínimos quadrados com restrição, seção a seção). |

A senha nunca é gravada: `pro/usuarios.json` guarda, por usuário, a chave dos dados embrulhada por uma chave derivada da senha (PBKDF2-SHA256 + AES-GCM).

`spec/bu.asn1`: especificação pública do boletim de urna publicada pelo TSE, na versão didática do repositório [doccaz/urnas-br](https://github.com/doccaz/urnas-br) (MIT).
