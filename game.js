/* BioQuest - game.js (FULL FILE)
   Multi-level support + in-game progression (Next Level button).

   Reads boot info from:
     window.BIOQUEST_SESSION_BOOT = { classCode, studentId, mode, levelId }

   Loads questions from:
     ./data/questions_<levelId>.json

   Completion is ALWAYS possible:
     - Flag unlocks after requiredQuestions are answered (finishable)
     - Mastery is tracked (passable) and logged

   New:
     - Results screen includes "Next Level (N)" when available
     - Clicking Next loads the next JSON and restarts the Phaser game directly
*/

(() => {
  // ---------- Boot session ----------
  const boot = window.BIOQUEST_SESSION_BOOT || null;
  if (!boot || !boot.classCode || !boot.studentId || !boot.mode) {
    const ui = document.getElementById("ui");
    if (ui) {
      ui.innerHTML = `
        <div class="panel">
          <div class="small">Start the game from the level select screen.</div>
          <div class="small">If you see this on GitHub Pages, refresh and select a level.</div>
        </div>
      `;
    }
    return;
  }

  const session = {
    classCode: String(boot.classCode).trim().toUpperCase(),
    studentId: String(boot.studentId).trim(),
    mode: boot.mode === "practice" ? "practice" : "assessment"
  };

  const LEVEL_ORDER = ["world1-1", "world1-2", "world1-3"];

  function nextLevelId(current) {
    const i = LEVEL_ORDER.indexOf(current);
    if (i === -1) return null;
    return LEVEL_ORDER[i + 1] || null;
  }

  // ---------- Runtime loader (used for initial start AND next level) ----------
  async function loadRuntime(levelId) {
    if (!window.BQ) {
      alert("Storage library not loaded. Ensure shared/storage.js is included before game.js.");
      return null;
    }

    const classSettings = BQ.getClassSettings(session.classCode);

    let levelData;
    try {
      const path = `./data/questions_${levelId}.json`;
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
      levelData = await res.json();
      if (!levelData?.questions?.length) throw new Error("Question bank is empty or malformed.");
    } catch (e) {
      console.error(e);
      alert("Game failed to load level data.\n\n" + e.message);
      return null;
    }

    const settings = {
      masteryAccuracy: Number(levelData.masteryAccuracy ?? classSettings.masteryAccuracy ?? 70),
      attemptsAllowed: Number(classSettings.attemptsAllowed ?? 3),
      infiniteLives: (session.mode === "practice") ? true : !!classSettings.infiniteLives
    };

    return {
      session: { ...session, levelId },
      settings,
      level: {
        levelId: String(levelData.levelId || levelId),
        requiredQuestions: Number(levelData.requiredQuestions ?? 3),
        questions: levelData.questions
      }
    };
  }

  function startPhaser(runtime) {
    const config = {
      type: Phaser.AUTO,
      parent: "game",
      width: 960,
      height: 540,
      physics: {
        default: "arcade",
        arcade: { debug: false, gravity: { y: 0 } }
      },
      scene: [makeScene(runtime)]
    };

    if (window.__bioquestGame) window.__bioquestGame.destroy(true);
    window.__bioquestGame = new Phaser.Game(config);
  }

  // Expose a safe in-game loader for “Next Level”
  window.__bioquestStartLevel = async function (levelId) {
    const runtime = await loadRuntime(levelId);
    if (!runtime) return;

    // Keep boot updated (useful if you ever reload)
    window.BIOQUEST_SESSION_BOOT = {
      classCode: session.classCode,
      studentId: session.studentId,
      mode: session.mode,
      levelId
    };

    startPhaser(runtime);
  };

  // ---------- Initial start ----------
  (async () => {
    const initialLevel = String(boot.levelId || "world1-1").trim();
    await window.__bioquestStartLevel(initialLevel);
  })();

  // ---------- Scene ----------
  function makeScene(runtime) {
    const { session, settings, level } = runtime;

    return class BioQuestScene extends Phaser.Scene {
      constructor() {
        super("BioQuestScene");

        this.REQUIRED_QUESTIONS = Math.max(1, Number(level.requiredQuestions || 3));
        this.masteryAccuracy = Number(settings.masteryAccuracy ?? 70);

        this.score = 0;
        this.correct = 0;
        this.answered = 0;
        this.lives = 3;
        this.attempt = 1;
        this.levelStartMs = 0;
        this.qIndex = 0;

        this.enemySpeed = 80;
        this.enemyPatrolRange = 260;

        this.isQuestionOpen = false;
        this.isResultsOpen = false;

        this.flagUnlocked = false;

        this.flagMessageUntil = 0;
      }

      init(data) {
        if (data && Number.isFinite(data.attempt)) this.attempt = data.attempt;
      }

      createProceduralTextures() {
        if (this.textures.exists("cellPlayer")) return;

        // Player cell texture
        {
          const g = this.make.graphics({ x: 0, y: 0, add: false });
          const size = 48, cx = size / 2, cy = size / 2;

          g.fillStyle(0x5fd3ff, 1);
          g.fillCircle(cx, cy, 20);

          g.fillStyle(0xb8f0ff, 0.45);
          g.fillCircle(cx - 6, cy - 8, 10);

          g.fillStyle(0x3a4cff, 0.9);
          g.fillCircle(cx + 6, cy + 6, 8);

          g.fillStyle(0xffffff, 0.5);
          g.fillCircle(cx + 3, cy + 3, 3);

          g.lineStyle(3, 0x0b2a33, 0.9);
          g.strokeCircle(cx, cy, 20);

          g.generateTexture("cellPlayer", size, size);
          g.destroy();
        }

        // Platform
        {
          const p = this.make.graphics({ x: 0, y: 0, add: false });
          p.fillStyle(0x2f2f2f, 1);
          p.fillRoundedRect(0, 0, 64, 24, 10);
          p.lineStyle(2, 0x4a4a4a, 1);
          p.strokeRoundedRect(0, 0, 64, 24, 10);
          p.generateTexture("platform64", 64, 24);
          p.destroy();
        }

        // Coin
        {
          const c = this.make.graphics({ x: 0, y: 0, add: false });
          c.fillStyle(0xffd34d, 1);
          c.fillCircle(10, 10, 9);
          c.fillStyle(0xffffff, 0.45);
          c.fillCircle(7, 7, 4);
          c.generateTexture("coin20", 20, 20);
          c.destroy();
        }

        // Q-block
        {
          const q = this.make.graphics({ x: 0, y: 0, add: false });
          q.fillStyle(0xdedcff, 1);
          q.fillRoundedRect(0, 0, 28, 28, 6);
          q.lineStyle(2, 0xffffff, 1);
          q.strokeRoundedRect(0, 0, 28, 28, 6);

          q.lineStyle(3, 0x333366, 1);
          q.beginPath();
          q.moveTo(10, 9);
          q.lineTo(14, 7);
          q.lineTo(18, 9);
          q.lineTo(18, 12);
          q.lineTo(14, 14);
          q.lineTo(14, 18);
          q.strokePath();

          q.fillStyle(0x333366, 1);
          q.fillCircle(14, 22, 2);

          q.generateTexture("qblock28", 28, 28);
          q.destroy();
        }

        // Enemy
        {
          const e = this.make.graphics({ x: 0, y: 0, add: false });
          e.fillStyle(0xff6666, 1);
          e.fillRoundedRect(0, 0, 30, 30, 10);
          e.fillStyle(0xffffff, 0.35);
          e.fillRoundedRect(6, 6, 10, 10, 6);
          e.lineStyle(2, 0x5a1f1f, 0.8);
          e.strokeRoundedRect(0, 0, 30, 30, 10);
          e.generateTexture("enemy30", 30, 30);
          e.destroy();
        }

        // Flag
        {
          const f = this.make.graphics({ x: 0, y: 0, add: false });
          f.fillStyle(0x00ff66, 1);
          f.fillRoundedRect(0, 0, 18, 200, 8);
          f.lineStyle(2, 0x0a5a2a, 0.8);
          f.strokeRoundedRect(0, 0, 18, 200, 8);
          f.generateTexture("flag18x200", 18, 200);
          f.destroy();
        }
      }

      create() {
        const H = 540;
        const levelWidth = 3000;

        this.infiniteLives = !!settings.infiniteLives;
        this.attemptsAllowed = Number(settings.attemptsAllowed ?? 3);

        this.createProceduralTextures();

        this.cameras.main.setBackgroundColor("#0f1115");
        this.physics.world.setBounds(0, 0, levelWidth, H);

        this.hud = this.add.text(12, 10, "", {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#fff"
        }).setScrollFactor(0);

        this.flagMsg = this.add.text(480, 70, "", {
          fontFamily: "monospace",
          fontSize: "14px",
          color: "#cfe7ff",
          align: "center",
          wordWrap: { width: 920, useAdvancedWrap: true }
        }).setOrigin(0.5).setScrollFactor(0).setDepth(50).setVisible(false);

        this.platforms = this.physics.add.staticGroup();
        this.coins = this.physics.add.staticGroup();
        this.qblocks = this.physics.add.staticGroup();
        this.flag = this.physics.add.staticGroup();

        this.enemies = this.physics.add.group({
          classType: Phaser.Physics.Arcade.Sprite,
          allowGravity: true,
          immovable: false
        });

        // Ground
        for (let x = 0; x < levelWidth; x += 64) {
          const ground = this.add.image(x + 32, H - 18, "platform64");
          this.physics.add.existing(ground, true);
          this.platforms.add(ground);
        }

        // Layout
        this.buildLevelLayout(session.levelId, H);

        // Player
        this.player = this.physics.add.image(80, H - 90, "cellPlayer");
        this.player.setCollideWorldBounds(true);
        this.player.body.setGravityY(800);
        this.player.body.setSize(28, 34, true);

        // Flag
        const flagImg = this.add.image(levelWidth - 150, H - 120, "flag18x200");
        this.physics.add.existing(flagImg, true);
        this.flag.add(flagImg);

        // Colliders
        this.physics.add.collider(this.player, this.platforms);
        this.physics.add.collider(this.enemies, this.platforms);
        this.physics.add.collider(this.player, this.qblocks, this.onQBlockCollide, null, this);
        this.physics.add.collider(this.enemies, this.qblocks);

        // Overlaps
        this.physics.add.overlap(this.player, this.coins, this.onCoin, null, this);
        this.physics.add.overlap(this.player, this.enemies, this.onEnemy, null, this);
        this.physics.add.overlap(this.player, this.flag, this.onFlagTouch, null, this);

        // Camera
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setBounds(0, 0, levelWidth, H);

        // Controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

        this.buildQuestionUI();
        this.buildResultsUI();

        this.levelStartMs = Date.now();
        this.recomputeGateState();
        this.updateHUD();
      }

      buildLevelLayout(levelId, H) {
        const addCoin = (x, y) => this.spawnCoin(x, y);
        const addEnemy = (x, y) => this.spawnEnemy(x, y);
        const addQB = (x, y, id) => this.spawnQBlock(x, y, id);
        const addPlat = (x, y, w) => this.addPlatform(x, y, w);

        if (levelId === "world1-2") {
          addPlat(360, 390, 180);
          addPlat(720, 340, 200);
          addPlat(1060, 290, 180);
          addPlat(1440, 340, 240);
          addPlat(1880, 300, 220);
          addPlat(2320, 360, 220);

          addCoin(240, H - 90);
          addCoin(740, 300);
          addCoin(1080, 250);
          addCoin(1900, 260);

          addEnemy(560, H - 45);
          addEnemy(1180, H - 45);
          addEnemy(1700, H - 45);

          addQB(320, 300, "qb1");
          addQB(980, 260, "qb2");
          addQB(1600, 300, "qb3");
          addQB(2200, 320, "qb4");
          return;
        }

        if (levelId === "world1-3") {
          addPlat(380, 380, 180);
          addPlat(760, 330, 200);
          addPlat(1120, 280, 200);
          addPlat(1500, 330, 240);
          addPlat(1940, 280, 220);
          addPlat(2380, 330, 220);

          addCoin(220, H - 90);
          addCoin(780, 290);
          addCoin(1140, 240);
          addCoin(1960, 240);
          addCoin(2400, 290);

          addEnemy(520, H - 45);
          addEnemy(920, H - 45);
          addEnemy(1400, H - 45);
          addEnemy(2100, H - 45);

          addQB(320, 300, "qb1");
          addQB(900, 270, "qb2");
          addQB(1400, 300, "qb3");
          addQB(1900, 270, "qb4");
          addQB(2400, 300, "qb5");
          return;
        }

        // world1-1 default
        addPlat(380, 380, 180);
        addPlat(780, 320, 220);
        addPlat(1260, 360, 220);
        addPlat(1700, 320, 260);
        addPlat(2200, 360, 220);

        addCoin(220, H - 90);
        addCoin(420, 340);
        addCoin(820, 280);
        addCoin(1760, 280);

        addEnemy(520, H - 45);
        addEnemy(980, H - 45);
        addEnemy(1500, H - 45);

        addQB(320, 300, "qb1");
        addQB(1100, 300, "qb2");
        addQB(2050, 300, "qb3");
      }

      addPlatform(x, y, widthPx) {
        const segments = Math.max(1, Math.round(widthPx / 64));
        const totalW = segments * 64;
        for (let i = 0; i < segments; i++) {
          const img = this.add.image(x - totalW / 2 + 32 + i * 64, y, "platform64");
          this.physics.add.existing(img, true);
          this.platforms.add(img);
        }
      }

      spawnCoin(x, y) {
        const coin = this.add.image(x, y, "coin20");
        this.physics.add.existing(coin, true);
        this.coins.add(coin);
      }

      spawnEnemy(x, y) {
        const enemy = this.enemies.create(x, y, "enemy30");
        enemy.setCollideWorldBounds(true);

        enemy.body.setAllowGravity(true);
        enemy.body.setImmovable(false);
        enemy.body.setGravityY(900);
        enemy.body.setSize(26, 26, true);
        enemy.body.setMaxVelocity(240, 1200);

        const w = this.physics.world.bounds.width;
        enemy.patrolMinX = Math.max(20, x - this.enemyPatrolRange);
        enemy.patrolMaxX = Math.min(w - 20, x + this.enemyPatrolRange);
        enemy.body.setVelocityX(-this.enemySpeed);

        return enemy;
      }

      spawnQBlock(x, y, id) {
        const qb = this.add.image(x, y, "qblock28");
        this.physics.add.existing(qb, true);
        qb.qbId = id;
        qb.used = false;
        this.qblocks.add(qb);
      }

      recomputeGateState() {
        this.flagUnlocked = this.answered >= this.REQUIRED_QUESTIONS;
      }

      showFlagLockedMessage() {
        const needQ = Math.max(0, this.REQUIRED_QUESTIONS - this.answered);
        this.flagMsg.setText(`Flag is locked. Answer ${needQ} more question(s) to finish this level.`);
        this.flagMsg.setVisible(true);
        this.flagMessageUntil = Date.now() + 1600;
      }

      buildQuestionUI() {
        const W = 960, H = 540;

        const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55)
          .setScrollFactor(0).setDepth(1000).setVisible(false);

        const panel = this.add.rectangle(W / 2, H / 2, 820, 480, 0x141821, 0.95)
          .setScrollFactor(0).setDepth(1001).setVisible(false);
        panel.setStrokeStyle(2, 0x2a3242, 1);

        const title = this.add.text(W / 2, H / 2 - 220, "Question Block", {
          fontFamily: "monospace",
          fontSize: "18px",
          color: "#cfe7ff"
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1002).setVisible(false);

        const promptText = this.add.text(W / 2, H / 2 - 195, "", {
          fontFamily: "monospace",
          fontSize: "17px",
          color: "#ffffff",
          wordWrap: { width: 760, useAdvancedWrap: true }
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1002).setVisible(false);
        promptText.setFixedSize(760, 90);

        const explanationText = this.add.text(W / 2, H / 2 - 100, "", {
          fontFamily: "monospace",
          fontSize: "15px",
          color: "#cfe7ff",
          wordWrap: { width: 760, useAdvancedWrap: true }
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1002).setVisible(false);
        explanationText.setFixedSize(760, 65);

        const feedbackText = this.add.text(W / 2, H / 2 + 210, "", {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#ffffff"
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1002).setVisible(false);

        const continueBg = this.add.rectangle(W / 2, H / 2 + 255, 220, 48, 0x1e2431, 1)
          .setScrollFactor(0).setDepth(1002).setVisible(false);
        continueBg.setStrokeStyle(2, 0x2f3a50, 1);
        continueBg.setInteractive({ useHandCursor: true });

        const continueLabel = this.add.text(W / 2, H / 2 + 255, "Continue (Space/Enter)", {
          fontFamily: "monospace",
          fontSize: "14px",
          color: "#ffffff"
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1003).setVisible(false);

        const makeChoiceButton = (i, y) => {
          const bw = 760, bh = 64;

          const bg = this.add.rectangle(W / 2, y, bw, bh, 0x1e2431, 1)
            .setScrollFactor(0).setDepth(1002).setVisible(false);
          bg.setStrokeStyle(2, 0x2f3a50, 1);
          bg.setInteractive({ useHandCursor: true });

          const label = this.add.text(W / 2 - bw / 2 + 16, y, "", {
            fontFamily: "monospace",
            fontSize: "15px",
            color: "#ffffff",
            wordWrap: { width: bw - 32, useAdvancedWrap: true }
          }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1003).setVisible(false);
          label.setFixedSize(bw - 32, bh - 10);

          bg.on("pointerover", () => { if (this.isQuestionOpen) bg.setFillStyle(0x252c3d, 1); });
          bg.on("pointerout", () => { if (this.isQuestionOpen) bg.setFillStyle(0x1e2431, 1); });
          bg.on("pointerdown", () => { if (this.isQuestionOpen) this.submitChoice(i); });

          return { bg, label };
        };

        const c1 = makeChoiceButton(0, H / 2 - 5);
        const c2 = makeChoiceButton(1, H / 2 + 70);
        const c3 = makeChoiceButton(2, H / 2 + 145);
        const c4 = makeChoiceButton(3, H / 2 + 220);

        this._questionKeys = this.input.keyboard.addKeys({
          one: Phaser.Input.Keyboard.KeyCodes.ONE,
          two: Phaser.Input.Keyboard.KeyCodes.TWO,
          three: Phaser.Input.Keyboard.KeyCodes.THREE,
          four: Phaser.Input.Keyboard.KeyCodes.FOUR,
          n1: Phaser.Input.Keyboard.KeyCodes.NUMPAD_ONE,
          n2: Phaser.Input.Keyboard.KeyCodes.NUMPAD_TWO,
          n3: Phaser.Input.Keyboard.KeyCodes.NUMPAD_THREE,
          n4: Phaser.Input.Keyboard.KeyCodes.NUMPAD_FOUR,
          enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
          space: Phaser.Input.Keyboard.KeyCodes.SPACE
        });

        continueBg.on("pointerdown", () => { if (this.isQuestionOpen) this.confirmCloseQuestion(); });

        this.questionUI = {
          overlay, panel, title, promptText, explanationText, feedbackText,
          choices: [c1, c2, c3, c4],
          continueBg, continueLabel,
          current: null, qbRef: null,
          locked: false, answered: false
        };
      }

      openQuestion(q, qbRef) {
        if (this.isQuestionOpen || this.isResultsOpen) return;
        this.isQuestionOpen = true;
        this.physics.world.pause();

        const ui = this.questionUI;
        ui.current = q;
        ui.qbRef = qbRef;
        ui.locked = false;
        ui.answered = false;

        ui.feedbackText.setText("");
        ui.explanationText.setText("").setVisible(false);
        ui.continueBg.setVisible(false);
        ui.continueLabel.setVisible(false);

        ui.promptText.setText(q.prompt);

        for (let i = 0; i < 4; i++) {
          ui.choices[i].label.setText(`${i + 1}) ${q.choices[i] ?? ""}`);
          ui.choices[i].bg.setFillStyle(0x1e2431, 1);
          ui.choices[i].bg.setStrokeStyle(2, 0x2f3a50, 1);
        }

        ui.overlay.setVisible(true);
        ui.panel.setVisible(true);
        ui.title.setVisible(true);
        ui.promptText.setVisible(true);
        ui.feedbackText.setVisible(true);
        ui.choices.forEach(c => { c.bg.setVisible(true); c.label.setVisible(true); });
      }

      confirmCloseQuestion() {
        const ui = this.questionUI;
        if (!this.isQuestionOpen || !ui.answered) return;
        this.closeQuestion();
      }

      closeQuestion() {
        if (!this.isQuestionOpen) return;
        this.isQuestionOpen = false;

        const ui = this.questionUI;
        ui.overlay.setVisible(false);
        ui.panel.setVisible(false);
        ui.title.setVisible(false);
        ui.promptText.setVisible(false);
        ui.explanationText.setVisible(false);
        ui.feedbackText.setVisible(false);
        ui.choices.forEach(c => { c.bg.setVisible(false); c.label.setVisible(false); });
        ui.continueBg.setVisible(false);
        ui.continueLabel.setVisible(false);

        ui.current = null;
        ui.qbRef = null;
        ui.locked = false;
        ui.answered = false;

        this.physics.world.resume();
        this.recomputeGateState();
      }

      submitChoice(choiceIndex) {
        const ui = this.questionUI;
        if (!this.isQuestionOpen || ui.locked) return;

        ui.locked = true;
        ui.answered = true;

        const q = ui.current;
        if (!q) {
          ui.locked = false;
          ui.answered = false;
          return;
        }

        this.answered += 1;
        const isCorrect = (choiceIndex === q.answerIndex);
        if (isCorrect) this.correct += 1;

        const correctBtn = ui.choices[q.answerIndex];
        correctBtn.bg.setFillStyle(0x16351e, 1);
        correctBtn.bg.setStrokeStyle(2, 0x34c76a, 1);

        if (!isCorrect) {
          const chosen = ui.choices[choiceIndex];
          chosen.bg.setFillStyle(0x3a1414, 1);
          chosen.bg.setStrokeStyle(2, 0xff6b6b, 1);
        }

        const expl = (typeof q.explanation === "string") ? q.explanation.trim() : "";
        const correctText = (q.choices && q.choices[q.answerIndex] != null) ? String(q.choices[q.answerIndex]) : "";
        if (expl) {
          ui.explanationText.setText("Explanation: " + expl).setVisible(true);
        } else if (correctText) {
          ui.explanationText.setText("Correct answer: " + correctText).setVisible(true);
        }

        if (isCorrect) {
          ui.feedbackText.setText("Correct! +50 points");
          this.score += 50;
          if (ui.qbRef) this.spawnCoin(ui.qbRef.x, ui.qbRef.y - 30);
        } else {
          ui.feedbackText.setText("Incorrect! Enemy spawned");
          if (ui.qbRef) {
            const e = this.spawnEnemy(ui.qbRef.x + 40, ui.qbRef.y - 10);
            e.patrolMinX = Math.max(e.patrolMinX, ui.qbRef.x - 140);
            e.patrolMaxX = Math.min(e.patrolMaxX, ui.qbRef.x + 140);
          }
        }

        ui.continueBg.setVisible(true);
        ui.continueLabel.setVisible(true);
        ui.locked = false;
      }

      buildResultsUI() {
        const W = 960, H = 540;

        const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6)
          .setScrollFactor(0).setDepth(2000).setVisible(false);

        const panel = this.add.rectangle(W / 2, H / 2, 780, 460, 0x141821, 0.97)
          .setScrollFactor(0).setDepth(2001).setVisible(false);
        panel.setStrokeStyle(2, 0x2a3242, 1);

        const title = this.add.text(W / 2, H / 2 - 200, "Level Results", {
          fontFamily: "monospace",
          fontSize: "22px",
          color: "#cfe7ff"
        }).setOrigin(0.5).setScrollFactor(0).setDepth(2002).setVisible(false);

        const body = this.add.text(W / 2, H / 2 - 150, "", {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#ffffff",
          align: "center",
          wordWrap: { width: 720, useAdvancedWrap: true }
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(2002).setVisible(false);
        body.setFixedSize(720, 240);

        const makeBtn = (x, y, label) => {
          const bw = 360, bh = 52;
          const bg = this.add.rectangle(x, y, bw, bh, 0x1e2431, 1)
            .setScrollFactor(0).setDepth(2002).setVisible(false);
          bg.setStrokeStyle(2, 0x2f3a50, 1);
          bg.setInteractive({ useHandCursor: true });

          const txt = this.add.text(x, y, label, {
            fontFamily: "monospace",
            fontSize: "14px",
            color: "#ffffff"
          }).setOrigin(0.5).setScrollFactor(0).setDepth(2003).setVisible(false);

          bg.on("pointerover", () => { if (this.isResultsOpen) bg.setFillStyle(0x252c3d, 1); });
          bg.on("pointerout", () => { if (this.isResultsOpen) bg.setFillStyle(0x1e2431, 1); });

          return { bg, txt };
        };

        const btnRetry = makeBtn(W / 2, H / 2 + 120, "Retry (R / Enter)");
        const btnNext = makeBtn(W / 2, H / 2 + 180, "Next Level (N)");
        const btnMenu = makeBtn(W / 2, H / 2 + 240, "Return to Level Select (M)");

        this._resultsKeys = this.input.keyboard.addKeys({
          enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
          r: Phaser.Input.Keyboard.KeyCodes.R,
          n: Phaser.Input.Keyboard.KeyCodes.N,
          m: Phaser.Input.Keyboard.KeyCodes.M
        });

        btnRetry.bg.on("pointerdown", () => { if (this.isResultsOpen) this.onResultsRetry(); });
        btnNext.bg.on("pointerdown", () => { if (this.isResultsOpen) this.onResultsNext(); });
        btnMenu.bg.on("pointerdown", () => { if (this.isResultsOpen) this.onResultsMenu(); });

        this.resultsUI = {
          overlay, panel, title, body,
          btnRetry, btnNext, btnMenu,
          lastResult: null,
          nextId: null
        };
      }

      openResults(result) {
        if (this.isResultsOpen) return;
        this.isResultsOpen = true;

        if (this.isQuestionOpen) this.closeQuestion();
        this.physics.world.pause();

        // Unlock next level on completion
        if (result.completed) {
          const nextId = nextLevelId(result.levelId);
          if (nextId && typeof window.unlockLevel === "function") {
            try { window.unlockLevel(nextId); } catch {}
          }
        }

        const ui = this.resultsUI;
        ui.lastResult = result;
        ui.nextId = nextLevelId(result.levelId);

        const durationSec = Math.max(0, Math.round((result.durationMs || 0) / 1000));
        const mastered = !!result.masteryMet;

        ui.body.setText(
          `Level: ${result.levelId}\n` +
          `Completed: ${result.completed}\n\n` +
          `Accuracy: ${result.accuracy}% (Mastery: ${this.masteryAccuracy}%)\n` +
          `Questions: ${result.correct}/${result.answered} (Required: ${this.REQUIRED_QUESTIONS})\n` +
          `Score: ${result.score}\n` +
          `Time: ${durationSec}s\n` +
          (this.infiniteLives ? "" : `Lives Remaining: ${result.livesRemaining}\n`) +
          `Attempt Logged: ${result.attempt}/${this.attemptsAllowed}\n\n` +
          (mastered ? "✅ Mastery Met" : "❌ Mastery Not Met")
        );

        // Show/hide Next Level button depending on availability
        const hasNext = !!ui.nextId;
        ui.btnNext.bg.setVisible(hasNext);
        ui.btnNext.txt.setVisible(hasNext);

        ui.overlay.setVisible(true);
        ui.panel.setVisible(true);
        ui.title.setVisible(true);
        ui.body.setVisible(true);

        ui.btnRetry.bg.setVisible(true);
        ui.btnRetry.txt.setVisible(true);

        ui.btnMenu.bg.setVisible(true);
        ui.btnMenu.txt.setVisible(true);
      }

      closeResults() {
        if (!this.isResultsOpen) return;
        this.isResultsOpen = false;

        const ui = this.resultsUI;
        ui.overlay.setVisible(false);
        ui.panel.setVisible(false);
        ui.title.setVisible(false);
        ui.body.setVisible(false);

        ui.btnRetry.bg.setVisible(false);
        ui.btnRetry.txt.setVisible(false);

        ui.btnNext.bg.setVisible(false);
        ui.btnNext.txt.setVisible(false);

        ui.btnMenu.bg.setVisible(false);
        ui.btnMenu.txt.setVisible(false);

        ui.lastResult = null;
        ui.nextId = null;

        this.physics.world.resume();
      }

      onResultsRetry() {
        this.closeResults();
        this.scene.restart({ attempt: 1 });
      }

      onResultsNext() {
        const ui = this.resultsUI;
        if (!ui.nextId) return;

        // Keep it “in game”: start next level directly
        window.__bioquestStartLevel(ui.nextId);
      }

      onResultsMenu() {
        window.location.reload();
      }

      update() {
        if (this.flagMsg.visible && Date.now() > this.flagMessageUntil) {
          this.flagMsg.setVisible(false);
        }

        if (this.isResultsOpen) {
          const k = this._resultsKeys;
          if (k) {
            if (Phaser.Input.Keyboard.JustDown(k.enter) || Phaser.Input.Keyboard.JustDown(k.r)) this.onResultsRetry();
            if (Phaser.Input.Keyboard.JustDown(k.n)) this.onResultsNext();
            if (Phaser.Input.Keyboard.JustDown(k.m)) this.onResultsMenu();
          }
          this.updateHUD();
          return;
        }

        if (this.isQuestionOpen) {
          const k = this._questionKeys;
          const ui = this.questionUI;

          if (k && ui) {
            if (!ui.answered) {
              if (Phaser.Input.Keyboard.JustDown(k.one) || Phaser.Input.Keyboard.JustDown(k.n1)) this.submitChoice(0);
              if (Phaser.Input.Keyboard.JustDown(k.two) || Phaser.Input.Keyboard.JustDown(k.n2)) this.submitChoice(1);
              if (Phaser.Input.Keyboard.JustDown(k.three) || Phaser.Input.Keyboard.JustDown(k.n3)) this.submitChoice(2);
              if (Phaser.Input.Keyboard.JustDown(k.four) || Phaser.Input.Keyboard.JustDown(k.n4)) this.submitChoice(3);
            } else {
              if (Phaser.Input.Keyboard.JustDown(k.enter) || Phaser.Input.Keyboard.JustDown(k.space)) this.confirmCloseQuestion();
            }
          }

          this.updateHUD();
          return;
        }

        // Movement
        const left = this.cursors.left.isDown || this.keyA.isDown;
        const right = this.cursors.right.isDown || this.keyD.isDown;

        if (left) this.player.body.setVelocityX(-220);
        else if (right) this.player.body.setVelocityX(220);
        else this.player.body.setVelocityX(0);

        const onGround = this.player.body.blocked.down;
        if (this.cursors.up.isDown && onGround) this.player.body.setVelocityY(-560);

        // Enemy patrol
        this.enemies.children.iterate(e => {
          if (!e?.body) return;

          if (Math.abs(e.body.velocity.x) < 5) {
            const dir = (e.x <= (e.patrolMinX + 5)) ? 1 : -1;
            e.body.setVelocityX(dir * this.enemySpeed);
          }

          if (e.x <= e.patrolMinX) e.body.setVelocityX(this.enemySpeed);
          if (e.x >= e.patrolMaxX) e.body.setVelocityX(-this.enemySpeed);

          if (e.body.blocked.left || e.body.touching.left) e.body.setVelocityX(this.enemySpeed);
          if (e.body.blocked.right || e.body.touching.right) e.body.setVelocityX(-this.enemySpeed);
        });

        this.updateHUD();
      }

      onCoin(player, coin) {
        coin.destroy();
        this.score += 10;
      }

      onEnemy(player, enemy) {
        const playerFalling = player.body.velocity.y > 50;
        const playerAbove = player.y + 10 < enemy.y;

        if (playerFalling && playerAbove) {
          enemy.destroy();
          player.body.setVelocityY(-260);
          this.score += 25;
          return;
        }

        if (!this.infiniteLives) this.lives -= 1;

        player.body.setVelocityX(player.x < enemy.x ? -220 : 220);
        player.body.setVelocityY(-260);

        if (!this.infiniteLives && this.lives <= 0) {
          this.endAttempt(false, "out_of_lives");
        }
      }

      onQBlockCollide(player, qb) {
        if (qb.used) return;

        const hitFromBelow = player.body.touching.up && qb.body.touching.down;
        if (!hitFromBelow) return;

        qb.used = true;
        qb.setAlpha(0.55);

        const q = level.questions[this.qIndex % level.questions.length];
        this.qIndex++;

        this.openQuestion(q, qb);
      }

      onFlagTouch() {
        if (this.isQuestionOpen || this.isResultsOpen) return;

        this.recomputeGateState();

        if (!this.flagUnlocked) {
          this.showFlagLockedMessage();
          this.player.body.setVelocityX(-80);
          return;
        }

        this.endAttempt(true, "completed");
      }

      endAttempt(completed, reason) {
        if (this.isResultsOpen) return;
        if (this.isQuestionOpen) this.closeQuestion();

        const ms = Date.now() - this.levelStartMs;
        const accuracy = this.answered === 0 ? 0 : Math.round((this.correct / this.answered) * 100);

        const result = {
          levelId: level.levelId || session.levelId,
          completed,
          reason,
          score: this.score,
          answered: this.answered,
          correct: this.correct,
          accuracy,
          livesRemaining: this.infiniteLives ? null : this.lives,
          attempt: this.attempt,
          durationMs: ms,
          atISO: new Date().toISOString(),
          masteryMet: accuracy >= this.masteryAccuracy,
          requiredQuestions: this.REQUIRED_QUESTIONS
        };

        try { BQ.writeResult(session.classCode, session.studentId, result); } catch (e) { console.error(e); }

        this.openResults(result);
      }

      updateHUD() {
        const accuracy = this.answered === 0 ? 0 : Math.round((this.correct / this.answered) * 100);
        const lifeText = this.infiniteLives ? "∞" : String(this.lives);
        const qProgress = `${Math.min(this.answered, this.REQUIRED_QUESTIONS)}/${this.REQUIRED_QUESTIONS}`;
        const flagStatus = this.flagUnlocked ? "UNLOCKED" : "LOCKED";
        const masteryStatus = (accuracy >= this.masteryAccuracy) ? "MET" : "NOT MET";

        this.hud.setText(
          `Level ${level.levelId || session.levelId}   Score ${this.score}   Lives ${lifeText}   Acc ${accuracy}%   Q ${this.correct}/${this.answered}\n` +
          `Finish Gate: ${flagStatus} (Questions ${qProgress})   Mastery: ${masteryStatus} (>= ${this.masteryAccuracy}%)`
        );
      }
    };
  }
})();

