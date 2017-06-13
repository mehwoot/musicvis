
var fftSize = 2048; // cannot be smaller than 512
var numTubes = 25;
var segments = 128;
var fps = 30;
var cameraPosition = 65;
var tubeExponent = 1.05;
var sliceGrouping = 1;

var magnitudes = [];
for (var i=0; i<numTubes * 8; i++) {
  magnitudes.push(0);
}

var canvas;
var gl;
var tubeBuffers = [];
var squareVerticesColorBuffer;
var mvMatrix;
var shaderProgram;
var vertexPositionAttribute;
var vertexColorAttribute;
var perspectiveMatrix;
var audioContext;
var song;
var analyserNode = null;


function start() {
  canvas = document.getElementById("glcanvas");
  initWebGL(canvas);
  initAudio();
  // loadSound("https://p.scdn.co/mp3-preview/90bd7919020cb2d237d881e5ccf06fe6a7361e05?cid=null")
  startMicrophone();

  if (gl) {
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    initShaders();
    initBuffers();
    setInterval(update, 1000 / fps);
  }
}

function update() {
  drawScene();
  updateFFT();
}

function startMicrophone () {
  if (!navigator.getUserMedia) {
    navigator.getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  }
  if (!navigator.cancelAnimationFrame) {
    navigator.cancelAnimationFrame = navigator.webkitCancelAnimationFrame || navigator.mozCancelAnimationFrame;
  }
  if (!navigator.requestAnimationFrame) {
    navigator.requestAnimationFrame = navigator.webkitRequestAnimationFrame || navigator.mozRequestAnimationFrame;
  } 

  navigator.getUserMedia(
    {
        "audio": {
            "mandatory": {
                "googEchoCancellation": "false",
                "googAutoGainControl": "false",
                "googNoiseSuppression": "false",
                "googHighpassFilter": "false"
            },
            "optional": []
        },
    }, gotStream, function(e) {
        alert('Error getting audio');
        console.log(e);
    });
}

function gotStream(stream) {

  song = audioContext.createMediaStreamSource(stream);
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = fftSize;
  song.connect(analyserNode);
}


function updateFFT() {
  if (analyserNode) {
    var freqByteData = new Uint8Array(analyserNode.frequencyBinCount);
    var numBars = 8.0;

    analyserNode.getByteFrequencyData(freqByteData);

    var outputs = []
    var startIndex = 0
    var windowSize = (analyserNode.fftSize / 512)
    var multiplier = 1

    for (var i = 0; i < numBars; ++i) {
        var magnitude = 0;
        var extraMultiplier = 1.0;
        if (i == 7) {
          extraMultiplier = 1.75;
        }
        if (i == 0 || i == 1) {
          extraMultiplier = 1.1;
        }
        for (var j = 0; j< windowSize; j++)
            magnitude += freqByteData[startIndex + j];
        magnitude = magnitude / windowSize;
        magnitude *= multiplier * extraMultiplier;
        startIndex += windowSize;
        windowSize *= 2;
        multiplier *= 1.15;
        magnitude /= 220.0;
        magnitude = Math.min(1.0, magnitude);
        magnitude = magnitude * magnitude * magnitude;
        magnitudes.push(magnitude);
        magnitudes.shift();
    }
  }
}

function initWebGL() {
  gl = null;
  try {
    gl = canvas.getContext("experimental-webgl");
  }
  catch(e) {
  }
  if (!gl) {
    alert("Unable to initialize WebGL. Your browser may not support it.");
  }
  //console.log(gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS));
}

function initAudio() {
  try {
    window.AudioContext = window.AudioContext||window.webkitAudioContext;
    audioContext = new AudioContext();
  }
  catch(e) {
    alert('Web Audio API is not supported in this browser');
  }
}

function loadSound(url) {
  var request = new XMLHttpRequest();
  request.open('GET', url, true);
  request.responseType = 'arraybuffer';

  request.onload = function() {
    audioContext.decodeAudioData(request.response, function(buffer) {
      song = buffer;
      playSound(song);
    }, function (error) {
      console.log("An error occured", error);
    });
  }
  request.send();
}

function playSound(buffer) {
  var source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);

  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = fftSize;
  source.connect(analyserNode);

  source.start(0);
}

function generateTubularBuffer(innerRadius, outerRadius, segments, startAngle) {
  var buffer = gl.createBuffer();
  var angleDelta = (2 * 3.14159265) / (segments * 2);
  var vertices = [];

  for (var i=0; i<segments; i++) {
    var segmentCount = (i % 8) / (8.0);
    vertices = vertices.concat([
      outerRadius * Math.cos(startAngle), outerRadius * Math.sin(startAngle), 0, segmentCount,
      innerRadius * Math.cos(startAngle), innerRadius * Math.sin(startAngle), 0, segmentCount
    ])
    startAngle += angleDelta;
    vertices = vertices.concat([
      outerRadius * Math.cos(startAngle), outerRadius * Math.sin(startAngle), 0, segmentCount
    ])
    startAngle += angleDelta;
    vertices = vertices.concat([
      innerRadius * Math.cos(startAngle), innerRadius * Math.sin(startAngle), 0, segmentCount,
      outerRadius * Math.cos(startAngle), outerRadius * Math.sin(startAngle), 0, segmentCount
    ])
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  return buffer;
}

function initBuffers() {
  var base = 0.0;
  var increment = 1.0;
  var startAngle = (2 * 3.14159265) * Math.random();
  for (var i=0; i<numTubes; i++) {
    if (i % sliceGrouping == 0) {
      startAngle = (2 * 3.14159265) * Math.random();
    }
    tubeBuffers.push(generateTubularBuffer(base,base + increment,segments, startAngle));
    base += increment;
    increment *= tubeExponent;
  }
}

function drawScene() {
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  perspectiveMatrix = makePerspective(45, 1920.0/1080.0, 0.1, cameraPosition + 25);

  loadIdentity();
  mvTranslate([-0.0, 0.0, -cameraPosition]);

  setMatrixUniforms();
  var magnitudesUniform = gl.getUniformLocation(shaderProgram, "magnitudes");
  gl.uniform1fv(magnitudesUniform, new Float32Array(magnitudes));
  var displacementMultiplerUniform = gl.getUniformLocation(shaderProgram, "displacementMultipler");
  gl.uniform1f(displacementMultiplerUniform, (cameraPosition / 65.0));
  var tubePositionUniform = gl.getUniformLocation(shaderProgram, "tubePosition");


  for (var i=0; i<tubeBuffers.length; i++) {
    var tubePosition = tubeBuffers.length - (i + 1)
    gl.uniform1i(tubePositionUniform, tubePosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, tubeBuffers[i]);
    gl.vertexAttribPointer(vertexPositionAttribute, 4, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 5 * segments);
  }
}

function initShaders() {
  var fragmentShader = getShader(gl, "shader-fs");
  var vertexShader = getShader(gl, "shader-vs");
  shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);
  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    alert("Unable to initialize the shader program: " + gl.getProgramInfoLog(shader));
  }
  gl.useProgram(shaderProgram);
  vertexPositionAttribute = gl.getAttribLocation(shaderProgram, "aVertexPosition");
  gl.enableVertexAttribArray(vertexPositionAttribute);
  // vertexColorAttribute = gl.getAttribLocation(shaderProgram, "aVertexColor");
  // gl.enableVertexAttribArray(vertexColorAttribute);
}

function getShader(gl, id) {
  var shaderScript = document.getElementById(id);
  if (!shaderScript) {
    return null;
  }
  var theSource = "";
  var currentChild = shaderScript.firstChild;

  while(currentChild) {
    if (currentChild.nodeType == 3) {
      theSource += currentChild.textContent;
    }
    currentChild = currentChild.nextSibling;
  }
  var shader;

  if (shaderScript.type == "x-shader/x-fragment") {
    shader = gl.createShader(gl.FRAGMENT_SHADER);
  } else if (shaderScript.type == "x-shader/x-vertex") {
    shader = gl.createShader(gl.VERTEX_SHADER);
  } else {
    return null;  // Unknown shader type
  }

  gl.shaderSource(shader, theSource);

  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
    return null;
  }

  return shader;
}

function loadIdentity() {
  mvMatrix = Matrix.I(4);
}

function multMatrix(m) {
  mvMatrix = mvMatrix.x(m);
}

function mvTranslate(v) {
  multMatrix(Matrix.Translation($V([v[0], v[1], v[2]])).ensure4x4());
}

function setMatrixUniforms() {
  var pUniform = gl.getUniformLocation(shaderProgram, "uPMatrix");
  gl.uniformMatrix4fv(pUniform, false, new Float32Array(perspectiveMatrix.flatten()));

  var mvUniform = gl.getUniformLocation(shaderProgram, "uMVMatrix");
  gl.uniformMatrix4fv(mvUniform, false, new Float32Array(mvMatrix.flatten()));
}
