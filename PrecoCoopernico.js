const CONFIG = {

  // API
  API_URL: "https://dados.tiagofelicia.pt/data/omie/hoje.json",

  // Valor usado quando não há preço disponível
  ERROR_VALUE: 88888.88888,

  // Timeout HTTP
  HTTP_TIMEOUT_SEC: 10,

  // Alterar também a cor do LED de OFF
  LED_OFF_ENABLED: false,

  // COOPÉRNICO ÚNICO
  COOP_FP: 0.15,
  COOP_MARGIN: 0.009,
  TAR: 0.0607,

  // ESCALÕES DE PREÇO COOPÉRNICO
  THRESHOLDS: {
    CYAN: 0.1,
    GREEN: 0.2,
    ORANGE: 0.3,
    RED: 0.4
  },

  // CORES RGB
  COLORS: {
    CYAN:   [0,100,75],
    GREEN:  [0,100,0],
    ORANGE: [100,45,0],
    RED:    [100,0,0],
    PURPLE: [100,0,40],
    ERROR:  [100,60,60]
  }
};


// CACHE OMIE
// Mantém apenas uma string com os preços de hoje

let omieHoje = null;
let dataHoje = null;


// ÚLTIMA COR
let lastColor = null;


// COMPARAR CORES

function sameColor(a,b){

  if(a === null || b === null){
    return false;
  }

  return(
    a[0] === b[0] &&
    a[1] === b[1] &&
    a[2] === b[2]
  );
}


// LED LOCAL

function led(c){

  if(sameColor(lastColor,c)){
    return;
  }

  const cores = {
    on:{rgb:c}
  };

  if(CONFIG.LED_OFF_ENABLED){
    cores.off = {rgb:c};
  }

  Shelly.call("PLUGS_UI.SetConfig",{
    config:{
      leds:{
        colors:{
          "switch:0":cores
        }
      }
    }
  });

  lastColor = c;
}


// DATA ATUAL

function getDateKey(t){

  const d = new Date(t*1000);

  let mes = d.getMonth()+1;
  let dia = d.getDate();

  if(mes<10){
    mes = "0"+mes;
  }

  if(dia<10){
    dia = "0"+dia;
  }

  return(
    d.getFullYear()+"-"+
    mes+"-"+
    dia
  );
}


// OBTER BLOCO DE PREÇOS

function obterValores(b,nome){

  const pos = b.indexOf('"'+nome+'"');

  if(pos<0){
    return null;
  }

  const ptPos = b.indexOf('"pt"',pos);

  if(ptPos<0){
    return null;
  }

  const valPos = b.indexOf('"valores":',ptPos);

  if(valPos<0){
    return null;
  }

  const ini = b.indexOf("[",valPos);

  if(ini<0){
    return null;
  }

  const fim = b.indexOf("]",ini);

  if(fim<0){
    return null;
  }

  return b.slice(ini+1,fim);
}


// OBTER DATA DO BLOCO

function obterData(b,nome){

  const pos = b.indexOf('"'+nome+'"');

  if(pos<0){
    return null;
  }

  const dataPos = b.indexOf('"data":',pos);

  if(dataPos<0){
    return null;
  }

  const ini = b.indexOf('"',dataPos+7);

  if(ini<0){
    return null;
  }

  const fim = b.indexOf('"',ini+1);

  if(fim<0){
    return null;
  }

  return b.slice(ini+1,fim);
}


// OBTER PREÇO DO CACHE

function obterPreco(t){

  if(dataHoje!==getDateKey(t) || omieHoje===null){
    return null;
  }

  const d = new Date(t*1000);

  const indice =
    d.getHours()*4+
    Math.floor(d.getMinutes()/15);

  let inicio = 0;
  let i = 0;

  while(i<indice){

    inicio = omieHoje.indexOf(",",inicio);

    if(inicio<0){
      return null;
    }

    inicio++;
    i++;
  }

  let fim = omieHoje.indexOf(",",inicio);

  if(fim<0){
    fim = omieHoje.length;
  }

  if(omieHoje.slice(inicio,fim).indexOf("null")===0){
    return 333.333;
  }

  const p = parseFloat(
    omieHoje.slice(inicio,fim)
  );

  if(isNaN(p)){
    return null;
  }

  return p;
}


// ATUALIZAR CACHE OMIE

function atualizarOmie(t,callback){

  const dateKey = getDateKey(t);

  if(omieHoje!==null && dataHoje===dateKey){
    callback(true);
    return;
  }

  carregarOmie(t,callback);
}


// CARREGAR APENAS OS PREÇOS DE HOJE

function carregarOmie(t,callback){

  print("A obter preços OMIE de hoje...");

  const dateKey = getDateKey(t);

  Shelly.call("HTTP.GET",{
    url:CONFIG.API_URL,
    timeout:CONFIG.HTTP_TIMEOUT_SEC
  },function(r,e){

    if(e || !r || !r.body){

      print("HTTP OMIE ERR "+e);

      if(r){
        r.body = null;
      }

      callback(
        omieHoje!==null &&
        dataHoje===dateKey
      );

      return;
    }

    let body = r.body;

    const dataH = obterData(body,"hoje");

    if(dataH!==dateKey){

      print(
        "OMIE DATA INVALIDA | ESPERADO "+
        dateKey+" | API "+dataH
      );

      body = null;
      r.body = null;

      callback(
        omieHoje!==null &&
        dataHoje===dateKey
      );

      return;
    }

    const hoje = obterValores(body,"hoje");

    if(hoje!==null){

      omieHoje = hoje;
      dataHoje = dataH;

      print("OMIE HOJE OK | DATA VALIDADA");

    }
    else{

      print("OMIE HOJE INVALIDO | PREÇOS AUSENTES");

    }

    body = null;
    r.body = null;

    callback(
      omieHoje!==null &&
      dataHoje===dateKey
    );

  });
}


// VALOR DE ERRO

function setErrorValue(){

  Shelly.call("Number.Set",{
    id:200,
    value:CONFIG.ERROR_VALUE
  });

  led(CONFIG.COLORS.ERROR);
}


// UPDATE

function update(){

  const t = Math.floor(Date.now()/1000);
  const dateKey = getDateKey(t);

  if(dataHoje!==null && dataHoje!==dateKey){

    omieHoje = null;
    dataHoje = null;
    lastColor = null;

    print("NOVO DIA | CACHE LIMPO | A OBTER PREÇOS");
  }

  atualizarOmie(t,function(ok){

    if(!ok){

      print("PRICE DATA ERR | COR: ROSA");

      setErrorValue();

      return;
    }

    const p = obterPreco(t);

    if(p===null){

      print("PRICE NOT FOUND | COR: ROSA");

      setErrorValue();

      return;
    }

    // Cálculo Coopérnico Único
    const coop =
      ((p/1000)*
      (1+CONFIG.COOP_FP)+
      CONFIG.COOP_MARGIN)+
      CONFIG.TAR;

    let cor;
    let rgb;

    if(coop<CONFIG.THRESHOLDS.CYAN){

      cor = "CIAN";
      rgb = CONFIG.COLORS.CYAN;

    }
    else if(coop<CONFIG.THRESHOLDS.GREEN){

      cor = "VERDE";
      rgb = CONFIG.COLORS.GREEN;

    }
    else if(coop<CONFIG.THRESHOLDS.ORANGE){

      cor = "LARANJA";
      rgb = CONFIG.COLORS.ORANGE;

    }
    else if(coop<CONFIG.THRESHOLDS.RED){

      cor = "VERMELHO";
      rgb = CONFIG.COLORS.RED;

    }
    else{

      cor = "ROXO";
      rgb = CONFIG.COLORS.PURPLE;

    }

    print(
      "OMIE "+p+
      " €/MWh | COOP ÚNICO ~"+
      coop.toFixed(3)+
      " €/kWh | COR: "+cor
    );

    // Enviar o preço para Number:200
    Shelly.call("Number.Set",{
      id:200,
      value:coop
    });

    // Atualizar a cor do LED
    led(rgb);

  });
}


// PRIMEIRA ATUALIZAÇÃO

update();


// PRÓXIMA ATUALIZAÇÃO

function scheduleNextUpdate(){

  const now = Date.now();
  const quarter = 15*60*1000;

  const next =
    (Math.floor(now/quarter)+1)*quarter+
    5000;

  Timer.set(
    next-now,
    false,
    function(){

      update();
      scheduleNextUpdate();

    }
  );
}

scheduleNextUpdate();
