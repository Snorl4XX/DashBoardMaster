from jmslib import config
from jmslib.texto import (colchete, criar_busca, lista_de_padroes, normalizar, para_data, primeiro_colchete, remessas_de_texto,
                          remover_codigo_login, turno_de)


def test_busca_ignora_acento_maiusculas_e_espacos_nos_colchetes():
    busca = criar_busca("A encomenda expressa está [ SP GRU] sendo enviada")
    assert busca("A encomenda expressa está [SP GRU] sendo enviada, para [DC S-MOO 02-SP], escaneador [X]")
    assert busca("a ENCOMENDA expressa esta [sp gru ]  sendo enviada")
    assert not busca("A encomenda expressa está [MT CGB] sendo enviada, para [SP GRU]")


def test_busca_com_coringa_e_padrao_vazio():
    busca = criar_busca("O expresso chegou [SP GRU]*parada anterior foi")
    assert busca("O expresso chegou [SP GRU] A parada anterior foi [], escaneador [x]")
    assert criar_busca("   ") is None


def test_valores_entre_colchetes():
    d = ("A encomenda expressa está [SP GRU] sendo enviada, para [DC S-MOO 02-SP], escaneador [GIOVANNA TESTE], "
         "o número do pedido [SRTR22606458660], número do voo [], número do pacote [BR10500432420]")
    assert primeiro_colchete(d) == "SP GRU"
    assert colchete(d, "para") == "DC S-MOO 02-SP"
    assert colchete(d, "escaneador") == "GIOVANNA TESTE"
    assert colchete(d, "pedido") == "SRTR22606458660"
    assert colchete(d, "pacote") == "BR10500432420"
    assert colchete("escaneador é [X1-Nome]", "escaneador") == "X1-Nome"
    assert colchete("sem nada", "pedido") == ""


def test_remover_codigo_do_login():
    assert remover_codigo_login("01964841-Regiane Teste") == "Regiane Teste"
    assert remover_codigo_login("TEMPSPGRU01-Temporário SP GRU 01") == "Temporário SP GRU 01"
    assert remover_codigo_login("TAC CARRO NBD - MARIA") == "TAC CARRO NBD - MARIA"


def test_turnos_nas_bordas():
    assert turno_de("2026-09-23 06:00:00") == "T1"
    assert turno_de("2026-09-23 13:59:59") == "T1"
    assert turno_de("2026-09-23 14:00:00") == "T2"
    assert turno_de("2026-09-23 21:59:59") == "T2"
    assert turno_de("2026-09-23 22:00:00") == "T3"
    assert turno_de("2026-09-23 05:59:59") == "T3"
    assert turno_de("") == config.SEM_TURNO


def test_datas():
    assert para_data("2026-09-09 15:36:02").hour == 15
    assert para_data("09/09/2026 15:36").minute == 36
    assert para_data("2026-09-09T15:36:02.000Z").second == 2
    assert para_data("lixo") is None


def test_remessas_coladas():
    lista, rep, inv = remessas_de_texto("888002517578525\n888002517578525, 999882069177254;  x\t888002525542695.0")
    assert lista == ["888002517578525", "999882069177254", "888002525542695"]
    assert rep == 1 and inv == 1


def test_padroes_sem_repetir():
    assert lista_de_padroes("A [SP GRU]\n\na [ sp gru]\nB") == ["A [SP GRU]", "B"]
    assert normalizar("Está  [ SP GRU ]") == "esta [sp gru]"
