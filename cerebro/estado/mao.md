## Objetivo
Desenvolver prótese / mão robótica articulada funcional em PETG-CF impressa em 3D, acionada por tendões de Kevlar e servomotores.

## Stack
- 3D / CAD: Blender 5.2.3 LTS (`scripts/gerar_mao_blender.py`) + Anycubic Slicer Next.
- Eletrônica: ESP32 + Módulo I2C PCA9685 + Fonte 6V 5A.
- Servos: 4x MG996R (antebraço) e 1x MG90S Metal Gear (embutido na palma para o polegar).
- Mecânica: 14 pinos de aço inox Ø 2.0 mm (12/14/16 mm), cordão trançado de Kevlar 0.8-1.0 mm (flexão) e cordão elástico 1.5 mm revestido em poliéster (retorno dorsal) + pads de silicone.

## Decisões
- Sincronizar sempre alterações entre `blender/mao_robotica_montada_realista.blend` e `blender/mao_pecas_impressao_3d.blend` (18 peças em Z=0 e STLs individuais).
- Substituído SG90 por MG90S (engrenagens metálicas, 2.2 kgf.cm) e filamento nos eixos por pinos de aço inox Ø 2.0 mm embutidos.

## Estado atual
- Modelo 3D V7 concluído e sincronizado nos 2 arquivos `.blend` e 18 `.stl` (topo da palma corrigido sem deformações nas linguetas MCP).
- Gerados 2 manuais PDF ilustrados: `Manual_Impressao_e_Especificacoes_Protese_MAO.pdf` e `Guia_Montagem_Passo_a_Passo_Iniciante_MAO.pdf`.

## Próximos passos
- Fatiar e imprimir as 18 peças em PETG-CF no Anycubic Slicer Next.
- Programar firmware do ESP32 + PCA9685 para calibração em 0° e controle de gestos.

## Armadilhas
- Nunca alimentar os servos pelo 5V do ESP32; usar fonte 6V 5A no borne do PCA9685 e ligar servos em 0° antes de amarrar os tendões de Kevlar.
- Nos furos das linguetas MCP do topo da palma, restringir o cilindro booleano à largura da lingueta para não cortar a rampa da palma.
