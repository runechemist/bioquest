/* BioQuest MVP - game.js (FULL FILE, POLISHED VISUALS + IN-GAME QUESTION PANEL, FIXED LAYOUT)
   Works on GitHub Pages.

   Key upgrade:
   - In-game modal question panel (no prompt()) with buttons + keys 1–4
   - Gameplay paused while modal is open
   - FIXED: question/answer text now stays inside the modal (no spill)

   Other features:
   - Procedural textures (no external assets)
   - Player looks like a cell
   - Rounded platform tiles
   - Coins + Q-blocks textured
   - Q-blocks SOLID; question triggers only on bottom-hit
   - Enemies patrol within bounds and bounce back

   Files expected:
   - /shared/storage.js  (provides window.BQ)
   - /data/questions_world1-1.json
*/

(() => {
  const UI = document.getElementById("ui");

  function uiTemplate() {
    UI.innerHTML = `
      <div class="panel">
        <div class="row">
          <div>
            <label>Class Code</label>
            <input id="classCode" placeholder="e.g., AB3K9Q" maxlength="12" />
            <div class="small">Teacher creates this code in the dashboard.</div>
          </div>
          <div>
            <label>Student ID (nickname or last-4)</label>
            <input id="studentId" placeholder="e.g., MARLIN123 or 4821" maxlength="24" />
            <div class="small">Use a non-identifying nickname if desired.</div>
          </div>
          <div>
            <label>Mode</label>
            <select id="mode">
              <option value="assessment">Assessment</option>
              <option value="practice">Practice</option>
            </select>
            <div class="small">Assessment uses attempts/lives; Practice can be infinite.</div>
          </div>
        </div>
        <div class="row">
          <button id="startBtn">Start World 1-1</button>
        </div>
        <div class="small">
          Controls: A/D or ◀▶ to move. ▲ to jump. Stomp enemies from above. Answer with buttons or 1–4 keys.
        </div>
      </div>
    `;
  }

  uiTemplate();

  const startBtn = document.getElementById("startBtn");
  startBtn.addEventListener("click", onStart);

  async function onStart() {
    const classCode = (document.getElementById("classCode").value || "").trim().toUpperCase();
    const studentId = (document.getElementById("studentId").value || "").trim();
    const mode = document.getElementById("mode").value;

    if (!classCode || !studentId) {
      alert("Enter Class Code and Student ID.");
      return;
    }
    if (!window.BQ) {
      alert("Storage library not loaded. Ensure shared/storage.js is included before game.js.");
      return;
    }

    const settings = BQ.getClassSettings(classCode);

    let questionBank;
    try {
      const res = await fetch("./data/questions_world1-1.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`questions_world1-1.json HTTP ${res.status}`);
      questionBank = await res.json();
      if (!questionBank?.questions?.length) throw new Error("Question bank is empty or malformed.");
    } catch (e) {
      console.error(e);
      alert("Game failed to load question data.\n\n" + e.message);
      return;
    }

    const session = {
      classCode,
      studentId,
      mode,
      settings,
      startedAtISO: new Date().toISOString()
    };

    UI.innerHTML = `
      <div class="panel">
        <span class="badge">Class ${escapeHtml(classCode)}</span>
        <span class="badge">Student ${escapeHtml(studentId)}</span>
        <span class="badge">${escapeHtml(mode)}</span>
      </div>
    `;

    startGame(session, questionBank);
  }

  function startGame(session, questionBank) {
    const config = {
      type: Phaser.AUTO,
      parent: "game",
      width: 960,
      height: 540,
      physics: {
        default: "arcade",
        arcade: { debug: false, gravity: { y: 0 } }
      },
      scene: [makeScene(session, questionBank)]
    };

    if (window.__bioquestGame) window.__bioquestGame.destroy(true);
    window.__bioquestGame = new Phaser.Game(config);
  }

  function makeScene(session, questionBank) {
    return class BioQuestScene extends Phaser.Scene {
      constructor() {
        super("BioQuestScene");
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
      }

      // ----- Texture generation (no external assets) -----
      createProceduralTextures() {
        if (this.textures.exists("cellPlayer")) return;

        // Player cell texture (48x48)
        {
          const g = this.make.graphics({ x: 0, y: 0, add: false });
          const size = 48;
          const cx = size / 2;
          const cy = size / 2;

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

        // Platform tile (64x24)
        {
          const p = this.make.graphics({ x: 0, y: 0, add: false });
          p.fillStyle(0x2f2f2f, 1);
          p.fillRoundedRect(0, 0, 64, 24, 10);
          p.lineStyle(2, 0x4a4a4a, 1);
          p.strokeRoundedRect(0, 0, 64, 24, 10);
          p.generateTexture("platform64", 64, 24);
          p.destroy();
        }

        // Coin (20x20)
        {
          const c = this.make.graphics({ x: 0, y: 0, add: false });
          c.fillStyle(0xffd34d, 1);
          c.fillCircle(10, 10, 9);
          c.fillStyle(0xffffff, 0.45);
          c.fillCircle(7, 7, 4);
          c.generateTexture("coin20", 20, 20);
          c.destroy();
        }

        // Q-block (28x28)
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

        // Enemy (30x30)
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

        // Flag (18x200)
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

        const s = session.settings || {};
        this.infiniteLives = (session.mode === "practice") ? true : !!s.infiniteLives;
        this.masteryAccuracy = Number(s.masteryAccuracy ?? 70);
        this.attemptsAllowed = Number(s.attemptsAllowed ?? 3);

        this.createProceduralTextures();

        this.cameras.main.setBackgroundColor("#0f1115");
        this.physics.world.setBounds(0, 0, levelWidth, H);

        // HUD
        this.hud = this.add.text(12, 10, "", {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#fff"
        }).setScrollFactor(0);

        // Groups
        this.platforms = this.physics.add.staticGroup();
        this.coins = this.physics.add.staticGroup();
        this.qblocks = this.physics.add.staticGroup();
        this.flag = this.physics.add.staticGroup();

        // Enemies: create via group.create for consistent Arcade behavior
        this.enemies = this.physics.add.group({
          classType: Phaser.Physics.Arcade.Sprite,
          allowGravity: true,
          immovable: false
        });

        // Ground tiles
        for (let x = 0; x < levelWidth; x += 64) {
          const ground = this.add.image(x + 32, H - 18, "platform64");
          this.physics.add.existing(ground, true);
          this.platforms.add(ground);
        }

        // Floating platforms
        this.addPlatform(380, 380, 180);
        this.addPlatform(780, 320, 220);
        this.addPlatform(1260, 360, 220);
        this.addPlatform(1700, 320, 260);
        this.addPlatform(2200, 360, 220);

        // Player
        this.player = this.physics.add.image(80, H - 90, "cellPlayer");
        this.player.setCollideWorldBounds(true);
        this.player.body.setGravityY(800);
        this.player.body.setSize(28, 34, true);

        // Coins
        this.spawnCoin(220, H - 90);
        this.spawnCoin(420, 340);
        this.spawnCoin(820, 280);
        this.spawnCoin(1760, 280);

        // Enemies (spawn slightly lower so they settle to ground quickly)
        this.spawnEnemy(520, H - 45);
        this.spawnEnemy(980, H - 45);
        this.spawnEnemy(1500, H - 45);

        // Q-blocks
        this.spawnQBlock(320, 300, "qb1");
        this.spawnQBlock(1100, 300, "qb2");
        this.spawnQBlock(2050, 300, "qb3");

        // Flag
        const flagImg = this.add.image(levelWidth - 150, H - 120, "flag18x200");
        this.physics.add.existing(flagImg, true);
        this.flag.add(flagImg);

        // Colliders
        this.physics.add.collider(this.player, this.platforms);
        this.physics.add.collider(this.enemies, this.platforms);

        // Q-blocks solid + trigger on bottom-hit
        this.physics.add.collider(this.player, this.qblocks, this.onQBlockCollide, null, this);
        this.physics.add.collider(this.enemies, this.qblocks);

        // Overlaps
        this.physics.add.overlap(this.player, this.coins, this.onCoin, null, this);
        this.physics.add.overlap(this.player, this.enemies, this.onEnemy, null, this);
        this.physics.add.overlap(this.player, this.flag, this.onWin, null, this);

        // Camera follow
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setBounds(0, 0, levelWidth, H);

        // Controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

        // In-game question UI (hidden until needed)
        this.buildQuestionUI();

        this.levelStartMs = Date.now();
        this.updateHUD();
      }

      // ----- Level building helpers -----
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

      // Enemies bounce back by patrolling within [patrolMinX, patrolMaxX]
      spawnEnemy(x, y) {
        const enemy = this.enemies.create(x, y, "enemy30");

        enemy.setCollideWorldBounds(true);
        enemy.body.setAllowGravity(true);
        enemy.body.setImmovable(false);
        enemy.body.setGravityY(900);
        enemy.body.setDrag(0, 0);
        enemy.body.setSize(26, 26, true);
        enemy.body.setMaxVelocity(240, 1200);
        enemy.body.setBounce(0, 0);

        const w = this.physics.world.bounds.width;
        enemy.patrolMinX = Math.max(20, x - this.enemyPatrolRange);
        enemy.patrolMaxX = Math.min(w - 20, x + this.enemyPatrolRange);

        enemy.body.setVelocityX(-this.enemySpeed);
        return enemy;
      }

      spawnQBlock(x, y, id) {
        const qb = this.add.image(x, y, "qblock28");
        this.physics.add.existing(qb, true); // static solid
        qb.qbId = id;
        qb.used = false;
        this.qblocks.add(qb);
      }

      // ----- In-game question modal (FIXED LAYOUT) -----
      buildQuestionUI() {
        const W = 960;
        const H = 540;

        const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55)
          .setScrollFactor(0)
          .setDepth(1000)
          .setVisible(false);

        const panel = this.add.rectangle(W / 2, H / 2, 820, 440, 0x141821, 0.95)
          .setScrollFactor(0)
          .setDepth(1001)
          .setVisible(false);

        panel.setStrokeStyle(2, 0x2a3242, 1);

        const title = this.add.text(W / 2, H / 2 - 195, "Question Block", {
          fontFamily: "monospace",
          fontSize: "18px",
          color: "#cfe7ff"
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1002).setVisible(false);

        const promptText = this.add.text(W / 2, H / 2 - 165, "", {
          fontFamily: "monospace",
          fontSize: "17px",
          color: "#ffffff",
          wordWrap: { width: 760, useAdvancedWrap: true }
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1002).setVisible(false);

        // Reserve a fixed prompt area so choices never collide with it
        promptText.setFixedSize(760, 90);

        const feedbackText = this.add.text(W / 2, H / 2 + 250, "", {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#ffffff"
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1002).setVisible(false);

        const makeChoiceButton = (i, y) => {
          const btnW = 760;
          const btnH = 64;

          const bg = this.add.rectangle(W / 2, y, btnW, btnH, 0x1e2431, 1)
            .setScrollFactor(0)
            .setDepth(1002)
            .setVisible(false);

          bg.setStrokeStyle(2, 0x2f3a50, 1);
          bg.setInteractive({ useHandCursor: true });

          const label = this.add.text(W / 2 - btnW / 2 + 16, y, "", {
            fontFamily: "monospace",
            fontSize: "15px",
            color: "#ffffff",
            wordWrap: { width: btnW - 32, useAdvancedWrap: true }
          }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1003).setVisible(false);

          // Keep label inside the button area
          label.setFixedSize(btnW - 32, btnH - 10);

          bg.on("pointerover", () => { if (this.isQuestionOpen) bg.setFillStyle(0x252c3d, 1); });
          bg.on("pointerout", () => { if (this.isQuestionOpen) bg.setFillStyle(0x1e2431, 1); });
          bg.on("pointerdown", () => { if (this.isQuestionOpen) this.submitChoice(i); });

          return { bg, label };
        };

        const c1 = makeChoiceButton(0, H / 2 - 10);
        const c2 = makeChoiceButton(1, H / 2 + 65);
        const c3 = makeChoiceButton(2, H / 2 + 140);
        const c4 = makeChoiceButton(3, H / 2 + 215);

        this.questionUI = {
          overlay, panel, title, promptText, feedbackText,
          choices: [c1, c2, c3, c4],
          current: null,
          qbRef: null,
          locked: false
        };

        // Keyboard shortcuts 1–4 (top row and numpad)
        const keys = this.input.keyboard.addKeys({
          one: Phaser.Input.Keyboard.KeyCodes.ONE,
          two: Phaser.Input.Keyboard.KeyCodes.TWO,
          three: Phaser.Input.Keyboard.KeyCodes.THREE,
          four: Phaser.Input.Keyboard.KeyCodes.FOUR,
          n1: Phaser.Input.Keyboard.KeyCodes.NUMPAD_ONE,
          n2: Phaser.Input.Keyboard.KeyCodes.NUMPAD_TWO,
          n3: Phaser.Input.Keyboard.KeyCodes.NUMPAD_THREE,
          n4: Phaser.Input.Keyboard.KeyCodes.NUMPAD_FOUR
        });

        this._questionKeys = keys;
      }

      openQuestion(q, qbRef) {
        if (this.isQuestionOpen) return;
        this.isQuestionOpen = true;

        // Pause physics while answering
        this.physics.world.pause();

        this.questionUI.current = q;
        this.questionUI.qbRef = qbRef;
        this.questionUI.locked = false;
        this.questionUI.feedbackText.setText("");

        this.questionUI.promptText.setText(q.prompt);

        for (let i = 0; i < 4; i++) {
          const text = `${i + 1}) ${q.choices[i] ?? ""}`;
          this.questionUI.choices[i].label.setText(text);
          this.questionUI.choices[i].bg.setFillStyle(0x1e2431, 1);
          this.questionUI.choices[i].bg.setStrokeStyle(2, 0x2f3a50, 1);
        }

        const ui = this.questionUI;
        ui.overlay.setVisible(true);
        ui.panel.setVisible(true);
        ui.title.setVisible(true);
        ui.promptText.setVisible(true);
        ui.feedbackText.setVisible(true);
        ui.choices.forEach(c => { c.bg.setVisible(true); c.label.setVisible(true); });
      }

      closeQuestion() {
        if (!this.isQuestionOpen) return;
        this.isQuestionOpen = false;

        const ui = this.questionUI;
        ui.overlay.setVisible(false);
        ui.panel.setVisible(false);
        ui.title.setVisible(false);
        ui.promptText.setVisible(false);
        ui.feedbackText.setVisible(false);
        ui.choices.forEach(c => { c.bg.setVisible(false); c.label.setVisible(false); });

        ui.current = null;
        ui.qbRef = null;
        ui.locked = false;

        this.physics.world.resume();
      }

      submitChoice(choiceIndex) {
        const ui = this.questionUI;
        if (!this.isQuestionOpen || ui.locked) return;
        ui.locked = true;

        const q = ui.current;
        if (!q) {
          ui.locked = false;
          this.closeQuestion();
          return;
        }

        this.answered += 1;
        const isCorrect = (choiceIndex === q.answerIndex);
        if (isCorrect) this.correct += 1;

        const chosen = ui.choices[choiceIndex];
        chosen.bg.setFillStyle(isCorrect ? 0x16351e : 0x3a1414, 1);
        chosen.bg.setStrokeStyle(2, isCorrect ? 0x34c76a : 0xff6b6b, 1);

        ui.feedbackText.setText(isCorrect ? "Correct! +50 points" : "Incorrect! Enemy spawned");

        if (isCorrect) {
          this.score += 50;
          const qb = ui.qbRef;
          if (qb) this.spawnCoin(qb.x, qb.y - 30);
        } else {
          const qb = ui.qbRef;
          if (qb) {
            const e = this.spawnEnemy(qb.x + 40, qb.y - 10);
            e.patrolMinX = Math.max(e.patrolMinX, qb.x - 140);
            e.patrolMaxX = Math.min(e.patrolMaxX, qb.x + 140);
          }
        }

        this.time.delayedCall(650, () => this.closeQuestion());
      }

      // ----- Gameplay loop -----
      update() {
        if (this.isQuestionOpen) {
          const k = this._questionKeys;
          if (k) {
            if (Phaser.Input.Keyboard.JustDown(k.one) || Phaser.Input.Keyboard.JustDown(k.n1)) this.submitChoice(0);
            if (Phaser.Input.Keyboard.JustDown(k.two) || Phaser.Input.Keyboard.JustDown(k.n2)) this.submitChoice(1);
            if (Phaser.Input.Keyboard.JustDown(k.three) || Phaser.Input.Keyboard.JustDown(k.n3)) this.submitChoice(2);
            if (Phaser.Input.Keyboard.JustDown(k.four) || Phaser.Input.Keyboard.JustDown(k.n4)) this.submitChoice(3);
          }
          this.updateHUD();
          return;
        }

        const left = this.cursors.left.isDown || this.keyA.isDown;
        const right = this.cursors.right.isDown || this.keyD.isDown;

        if (left) this.player.body.setVelocityX(-220);
        else if (right) this.player.body.setVelocityX(220);
        else this.player.body.setVelocityX(0);

        const onGround = this.player.body.blocked.down;
        if (this.cursors.up.isDown && onGround) this.player.body.setVelocityY(-560);

        // Enemy patrol: reverse at patrol edges or walls
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

          if (e.y > this.physics.world.bounds.height + 100) {
            e.y = 200;
            e.x = (e.patrolMinX + e.patrolMaxX) / 2;
            e.body.setVelocityX(-this.enemySpeed);
          }
        });

        this.updateHUD();
      }

      // ----- Interactions -----
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

        const q = questionBank.questions[this.qIndex % questionBank.questions.length];
        this.qIndex++;

        this.openQuestion(q, qb);
      }

      onWin() {
        if (this.isQuestionOpen) return;
        this.endAttempt(true, "completed");
      }

      endAttempt(completed, reason) {
        if (this.isQuestionOpen) this.closeQuestion();

        const ms = Date.now() - this.levelStartMs;
        const accuracy = this.answered === 0 ? 0 : Math.round((this.correct / this.answered) * 100);

        const result = {
          levelId: questionBank.levelId || "world1-1",
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
          masteryMet: accuracy >= this.masteryAccuracy
        };

        BQ.writeResult(session.classCode, session.studentId, result);

        alert(
          `Level End\n\n` +
          `Completed: ${completed}\n` +
          `Accuracy: ${accuracy}% (Mastery: ${this.masteryAccuracy}%)\n` +
          `Score: ${this.score}\n` +
          `Answered: ${this.correct}/${this.answered}\n` +
          `Attempt: ${this.attempt}/${this.attemptsAllowed}\n`
        );

        if (session.mode === "assessment" && !result.masteryMet) {
          this.attempt += 1;
          if (this.attempt > this.attemptsAllowed) {
            this.scene.restart();
            return;
          }
        }

        this.scene.restart();
      }

      updateHUD() {
        const accuracy = this.answered === 0 ? 0 : Math.round((this.correct / this.answered) * 100);
        const lifeText = this.infiniteLives ? "∞" : String(this.lives);
        this.hud.setText(`Score ${this.score}   Lives ${lifeText}   Acc ${accuracy}%   Q ${this.correct}/${this.answered}`);
      }
    };
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[c]));
  }
})();
