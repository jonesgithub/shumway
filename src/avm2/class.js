/*
 * Copyright 2013 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * AVM2 Class
 *
 * +---------------------------------+
 * | Class Object                    |<------------------------------+
 * +---------------------------------+                               |
 * | scope                           |     D'                        |
 * | classInfo                       |     ^                         |
 * | baseClass                       |     |                         |
 * |                                 |   +---+                       |
 * | dynamicPrototype ---------------+-->| D |                       |
 * |                                 |   +---+                       |
 * |                                 |     ^                         |
 * |                                 |     | .__proto__              |
 * |                                 |   +---+                       |
 * | traitsPrototype ----------------+-->| T |                       |
 * |                                 |   +---+                       |
 * |                                 |     ^                         |
 * |                                 |     | .prototype   +-------+  |
 * | instanceConstructor             |-----+------------->| class |--+
 * |                                 |     |              +-------+
 * | instanceConstructorNoInitialize |-----+
 * | call                            |
 * | apply                           |
 * +---------------------------------+
 *
 * D  - Dynamic prototype object.
 * D' - Base class dynamic prototype object.
 * T  - Traits prototype, class traits + base class traits.
 */

var Traits = (function () {
  function traits() {
    this.map = createEmptyObject();
  }
  traits.prototype.trace = function trace(writer) {
    for (var key in this.map) {
      var value = this.map[key];
      writer.writeLn(value.kindName() + ": " + key + " -> " + value);
    }
  };
  return traits;
})();

var ClassTraits = (function () {
  function classTraits(classInfo) {
    Traits.call(this);

    this.classInfo = classInfo;

    function getKey(key, trait) {
      if (trait.isGetter()) {
        key = "get " + key;
      } else if (trait.isSetter()) {
        key = "set " + key;
      }
      return key;
    }

    /**
     * Add class traits.
     */
    var traits = classInfo.traits;
    for (var i = 0; i < traits.length; i++) {
      var trait = traits[i];
      var name = Multiname.getQualifiedName(trait.name);
      var key = getKey(name, trait);
      this.map[key] = trait;
    }
  }
  classTraits.prototype = Object.create(Traits.prototype);
  return classTraits;
})();

var InstanceTraits = (function () {
  function instanceTraits(parent, instanceInfo) {
    Traits.call(this);
    this.parent = parent;
    this.instanceInfo = instanceInfo;
    this.interfaces = [];
    extend.call(this, parent);
  }

  function extend(parent) {
    var ii = this.instanceInfo, it;
    var map = this.map;
    var name, key, trait, protectedName, protectedKey;

    function getKey(key, trait) {
      if (trait.isGetter()) {
        key = "get " + key;
      } else if (trait.isSetter()) {
        key = "set " + key;
      }
      return key;
    }

    /**
     * Inherit parent traits.
     */
    if (parent) {
      for (key in parent.map) {
        trait = parent.map[key];
        map[key] = trait;
        if (trait.isProtected()) {
          // Inherit protected trait also in the local protected namespace.
          protectedName = Multiname.getQualifiedName(new Multiname([ii.protectedNs], trait.name.getName()));
          protectedKey = getKey(protectedName, trait);
          map[protectedKey] = trait;
        }
      }
    }

    function writeOrOverwriteTrait(object, key, trait) {
      var oldTrait = object[key];
      if (oldTrait) {
        assert (!oldTrait.isFinal(), "Cannot redefine a final trait: ", trait);
        // TODO: Object.as has a trait named length, we need to remove this since
        // it doesn't appear in Tamarin.
        assert (trait.isOverride() || trait.name.getName() === "length",
          "Overriding a trait that is not marked for override: ", trait);
      } else {
        assert (!trait.isOverride(), "Trait marked override must override another trait: ", trait);
      }
      object[key] = trait;
    }

    function overwriteProtectedTrait(object, key, trait) {
      if (key in object) {
        object[key] = trait;
      }
    }

    /**
     * Add instance traits.
     */
    var traits = ii.traits;
    for (var i = 0; i < traits.length; i++) {
      trait = traits[i];
      name = Multiname.getQualifiedName(trait.name);
      key = getKey(name, trait);
      writeOrOverwriteTrait(map, key, trait);
      if (trait.isProtected()) {
        // Overwrite protected traits.
        it = this.parent;
        while (it) {
          protectedName = Multiname.getQualifiedName(new Multiname([it.instanceInfo.protectedNs], trait.name.getName()));
          protectedKey = getKey(protectedName, trait);
          overwriteProtectedTrait(map, protectedKey, trait);
          it = it.parent;
        }
      }
    }

    /**
     * Add interface traits.
     */
    if (!ii.isInterface()) {
      var domain = ii.abc.domain;
      var interfaces = ii.interfaces;
      for (var i = 0; i < interfaces.length; i++) {
        it = domain.getProperty(interfaces[i], true, true).instanceTraits;
        for (var interfaceKey in it.map) {
          var interfaceTrait = it.map[interfaceKey];
          name = Multiname.getPublicQualifiedName(interfaceTrait.name.getName());
          key = getKey(name, interfaceTrait);
          map[interfaceKey] = map[key];
        }
      }
    }
  }
  instanceTraits.prototype = Object.create(Traits.prototype);
  instanceTraits.prototype.toString = function toString() {
    return this.instanceInfo.toString();
  };
  return instanceTraits;
})();

var Interface = (function () {
  function Interface(classInfo) {
    var ii = classInfo.instanceInfo;
    release || assert(ii.isInterface());
    this.name = ii.name;
    this.classInfo = classInfo;
  }

  Interface.createInterface = function createInterface(classInfo) {
    var ii = classInfo.instanceInfo;
    release || assert(ii.isInterface());
    if (traceExecution.value) {
      var str = "Creating Interface " + ii.name;
      if (ii.interfaces.length) {
        str += " implements " + ii.interfaces.map(function (name) {
          return name.getName();
        }).join(", ");
      }
      print(str);
    }
    var cls = new Interface(classInfo);
    if (ii.interfaces.length) {
      var domain = classInfo.abc.domain;
      assert (ii.interfaces.length === 1);
      var interface = domain.getProperty(ii.interfaces[0], true, true);
      cls.instanceTraits = new InstanceTraits(interface.instanceTraits, ii);
    } else {
      cls.instanceTraits = new InstanceTraits(null, ii);
    }
    return cls;
  };

  Interface.prototype = {
    toString: function () {
      return "[interface " + this.name + "]";
    },

    isInstance: function (value) {
      if (value === null || typeof value !== "object") {
        return false;
      }

      release || assert(value.class.implementedInterfaces,
        "No 'implementedInterfaces' map found on class " +
          value.class);

      var qualifiedName = Multiname.getQualifiedName(this.name);
      return value.class.implementedInterfaces[qualifiedName] !== undefined;
    },

    trace: function trace(writer) {
      writer.enter("interface " + this.name.getName());
      writer.enter("instanceTraits: ");
      this.instanceTraits.trace(writer);
      writer.outdent();
      writer.outdent();
      writer.leave("}");
    },

    call: function (v) {
      return v;
    },

    apply: function ($this, args) {
      return args[0];
    }
  };

  return Interface;
})();

var Class = (function () {
  var OWN_INITIALIZE   = 0x1;
  var SUPER_INITIALIZE = 0x2;

  function Class(name, instanceConstructor, callable) {
    this.debugName = name;

    if (instanceConstructor) {
      release || assert(instanceConstructor.prototype);
      this.instanceConstructor = instanceConstructor;
      this.instanceConstructorNoInitialize = instanceConstructor;
      this.hasInitialize = 0;
      this.instanceConstructor.class = this;
    }

    if (!callable) {
      callable = Domain.coerceCallable(this);
    } else if (callable === Domain.coerceCallable) {
      callable = Domain.coerceCallable(this);
    }
    defineNonEnumerableProperty(this, "call", callable.call);
    defineNonEnumerableProperty(this, "apply", callable.apply);
  }

  Class.createClass = function createClass(classInfo, baseClass, scope) {
    var ci = classInfo;
    var ii = ci.instanceInfo;
    var domain = ci.abc.domain;
    var className = Multiname.getName(ii.name);
    var isNativeClass = ci.native;
    if (isNativeClass) {
      var classBuilder = getNative(ci.native.cls);
      if (!classBuilder) {
        unexpected("No native for " + ci.native.cls);
      }
      // Special case Object, which has no base class but needs the Class class on the scope.
      if (!baseClass) {
        scope = new Scope(scope, Class);
      }
    }
    var classScope = new Scope(scope, null);
    var instanceConstructor = createFunction(ii.init, classScope);
    var cls;
    if (isNativeClass) {
      cls = classBuilder(domain, classScope, instanceConstructor, baseClass);
    } else {
      cls = new Class(className, instanceConstructor);
    }
    cls.classInfo = classInfo;
    cls.scope = classScope;
    classScope.object = cls;
    var classNatives;
    var instanceNatives;
    if (isNativeClass) {
      if (cls.native) {
        classNatives = cls.native.static;
        instanceNatives = cls.native.instance;
      }
    } else {
      cls.extend(baseClass);
    }
    cls.classTraits = new ClassTraits(classInfo);
    cls.instanceTraits = new InstanceTraits(baseClass ? baseClass.instanceTraits : null, ii);
    var baseBindings = baseClass ? baseClass.traitsPrototype : null;
    if (cls.instanceConstructor) {
      applyInstanceTraits(domain, cls.traitsPrototype, classScope, baseBindings, ii.traits, instanceNatives);
    }
    applyClassTraits(domain, cls, classScope, null, ci.traits, classNatives);
    defineReadOnlyProperty(cls, VM_IS_CLASS, true);
    return cls;
  };

  function setDefaultProperties(cls) {
    defineNonEnumerableProperty(cls.dynamicPrototype, Multiname.getPublicQualifiedName("constructor"), cls);
    defineReadOnlyProperty(cls.traitsPrototype, "class", cls);
    defineReadOnlyProperty(cls.instanceConstructor, "class", cls);
    defineObjectShape(cls.traitsPrototype);
  }

  Class.prototype = {
    setSymbol: function setSymbol(props) {
      this.instanceConstructor.prototype.symbol = props;
    },

    getSymbol: function getSymbol() {
      return this.instanceConstructor.prototype.symbol;
    },

    initializeInstance: function initializeInstance(obj) {
      // Initialize should be nullary and nonrecursive. If the script
      // needs to pass in script objects to native land, there's usually a
      // ctor function.
      var c = this;
      var initializes = [];
      while (c) {
        if (c.hasInitialize & OWN_INITIALIZE) {
          initializes.push(c.instanceConstructor.prototype.initialize);
        }
        c = c.baseClass;
      }
      var s;
      while ((s = initializes.pop())) {
        s.call(obj);
      }
      Counter.count("Initialize: " + this.classInfo.instanceInfo.name);
    },

    createInstance: function createInstance(args) {
      var o = Object.create(this.instanceConstructor.prototype);
      this.instanceConstructor.apply(o, args);
      return o;
    },

    createAsSymbol: function createAsSymbol(props) {
      var o = Object.create(this.instanceConstructor.prototype);
      // Custom classes will have already have .symbol linked.
      if (o.symbol) {
        var symbol = Object.create(o.symbol);
        for (var prop in props) {
          symbol[prop] = props[prop];
        }
        o.symbol = symbol;
      } else {
        o.symbol = props;
      }
      return o;
    },

    extendNative: function (baseClass, native) {
      this.baseClass = baseClass;
      this.dynamicPrototype = Object.getPrototypeOf(native.prototype);
      this.instanceConstructor.prototype = this.traitsPrototype = native.prototype;
      setDefaultProperties(this);
    },

    extendBuiltin: function(baseClass) {
      release || assert (baseClass);
      // Some natives handle their own prototypes/it's impossible to do the
      // traits/public prototype BS, e.g. Object, Array, etc.
      // FIXME: This is technically non-semantics preserving.
      this.baseClass = baseClass;
      this.dynamicPrototype = this.traitsPrototype = this.instanceConstructor.prototype;
      setDefaultProperties(this);
    },

    extend: function (baseClass) {
      release || assert (baseClass);
      this.baseClass = baseClass;
      this.dynamicPrototype = Object.create(baseClass.dynamicPrototype);
      if (baseClass.hasInitialize) {
        var instanceConstructorNoInitialize = this.instanceConstructor;
        var self = this;
        this.instanceConstructor = function () {
          self.initializeInstance(this);
          instanceConstructorNoInitialize.apply(this, arguments);
        };
        defineReadOnlyProperty(this.instanceConstructor, "class", instanceConstructorNoInitialize.class);
        this.hasInitialize |= SUPER_INITIALIZE;
      }
      this.instanceConstructor.prototype = this.traitsPrototype = Object.create(this.dynamicPrototype);
      setDefaultProperties(this);
    },

    setDefaultProperties: function () {
      setDefaultProperties(this);
    },

    link: function (definition) {
      release || assert(definition);
      release || assert(this.dynamicPrototype);

      if (definition.initialize) {
        if (!this.hasInitialize) {
          var instanceConstructorNoInitialize = this.instanceConstructor;
          var self = this;
          this.instanceConstructor = function () {
            self.initializeInstance(this);
            instanceConstructorNoInitialize.apply(this, arguments);
          };
          defineReadOnlyProperty(this.instanceConstructor, "class", instanceConstructorNoInitialize.class);
          this.instanceConstructor.prototype = instanceConstructorNoInitialize.prototype;
        }
        this.hasInitialize |= OWN_INITIALIZE;
      }

      var dynamicPrototype = this.dynamicPrototype;
      var keys = Object.keys(definition);
      for (var i = 0; i < keys.length; i++) {
        var propertyName = keys[i];
        Object.defineProperty(dynamicPrototype, propertyName, Object.getOwnPropertyDescriptor(definition, propertyName));
      }

      function glueProperties(obj, properties) {
        var keys = Object.keys(properties);
        for (var i = 0; i < keys.length; i++) {
          var propertyName = keys[i];
          var propertySimpleName = properties[propertyName];
          assert (isString(propertySimpleName), "Make sure it's not a function.");
          var qn = Multiname.getQualifiedName(Multiname.fromSimpleName(propertySimpleName));
          release || assert(isString(qn));
          var descriptor = Object.getOwnPropertyDescriptor(obj, qn);
          if (descriptor && descriptor.get) {
            Object.defineProperty(obj, propertyName, descriptor);
          } else {
            Object.defineProperty(obj, propertyName, {
              get: new Function("", "return this." + qn),
              set: new Function("v", "this." + qn + " = v")
            });
          }
        }
      }

      function generatePropertiesFromTraits(traits) {
        var properties = createEmptyObject();
        traits.forEach(function (trait) {
          var ns = trait.name.getNamespace();
          if (!ns.isPublic()) {
            return;
          }
          properties[trait.name.getName()] = "public " + trait.name.getName();
        });
        return properties;
      }

      var glue = definition.__glue__;
      if (!glue) {
        return;
      }

      // Accessors for script properties from within AVM2.
      if (glue.script) {
        if (glue.script.instance) {
          if (isNumber(glue.script.instance)) {
            assert (glue.script.instance === Glue.ALL);
            glueProperties(dynamicPrototype, generatePropertiesFromTraits(this.classInfo.instanceInfo.traits));
          } else {
            glueProperties(dynamicPrototype, glue.script.instance);
          }
        }
        if (glue.script.static) {
          if (isNumber(glue.script.static)) {
            assert (glue.script.static === Glue.ALL);
            glueProperties(this, generatePropertiesFromTraits(this.classInfo.traits));
          } else {
            glueProperties(this, glue.script.static);
          }
        }
      }
    },

    linkNatives: function (definition) {
      var glue = definition.__glue__;
      // assert (glue && glue.native);
      // Binding to member methods marked as [native].
      this.native = glue.native;
    },

    verify: function () {
      var instanceConstructor = this.instanceConstructor;
      var tP = this.traitsPrototype;
      var dP = this.dynamicPrototype;
      assert (instanceConstructor && tP && dP);
      assert (tP === instanceConstructor.prototype);
      assert (dP === instanceConstructor.prototype || dP === Object.getPrototypeOf(instanceConstructor.prototype));
      assert (isClass(this));
      if (tP !== Object.prototype) {
        // We don't want to put "class" and "shape" on the Object.prototype.
        assert (Object.hasOwnProperty.call(tP, "class"));
        assert (Object.hasOwnProperty.call(tP, "shape"), "Classes should have a shape ID.");
      }
      assert (instanceConstructor.class === this);
    },

    coerce: function (value) {
      return value;
    },

    isInstanceOf: function (value) {
      // TODO: Fix me.
      return this.isInstance(value);
    },

    isInstance: function (value) {
      if (value === null || typeof value !== "object") {
        return false;
      }
      return this.dynamicPrototype.isPrototypeOf(value);
    },

    trace: function trace(writer) {
      var description = this.debugName + (this.baseClass ? " extends " + this.baseClass.debugName : "");
      writer.enter("class " + description + " {");
      writer.writeLn("scope: " + this.scope);
      writer.writeLn("baseClass: " + this.baseClass);
      writer.writeLn("classInfo: " + this.classInfo);
      writer.writeLn("dynamicPrototype: " + this.dynamicPrototype);
      writer.writeLn("traitsPrototype: " + this.traitsPrototype);
      writer.writeLn("dynamicPrototype === traitsPrototype: " + (this.dynamicPrototype === this.traitsPrototype));

      writer.writeLn("instanceConstructor: " + this.instanceConstructor);
      writer.writeLn("instanceConstructorNoInitialize: " + this.instanceConstructorNoInitialize);
      writer.writeLn("instanceConstructor === instanceConstructorNoInitialize: " + (this.instanceConstructor === this.instanceConstructorNoInitialize));

      var traitsPrototype = this.traitsPrototype;
      writer.enter("traitsPrototype: ");
      if (traitsPrototype) {
        writer.enter("VM_SLOTS: ");
        writer.writeArray(traitsPrototype[VM_SLOTS].map(function (slot) {
          return slot.trait;
        }));
        writer.outdent();

        writer.enter("VM_BINDINGS: ");
        writer.writeArray(traitsPrototype[VM_BINDINGS].map(function (binding) {
          var pd = Object.getOwnPropertyDescriptor(traitsPrototype, binding);
          var str = binding;
          if (pd.get || pd.set) {
            if (pd.get) {
              str += " getter: " + debugName(pd.get);
            }
            if (pd.set) {
              str += " setter: " + debugName(pd.set);
            }
          } else {
            str += " value: " + debugName(pd.value);
          }
          return str;
        }));
        writer.outdent();

        writer.enter("VM_OPEN_METHODS: ");
        writer.writeArray(toKeyValueArray(traitsPrototype[VM_OPEN_METHODS]).map(function (pair) {
          return pair[0] + ": " + debugName(pair[1]);
        }));
        writer.outdent();

        writer.enter("classTraits: ");
        this.classTraits.trace(writer);
        writer.outdent();

        writer.enter("instanceTraits: ");
        this.instanceTraits.trace(writer);
        writer.outdent();
      }

      writer.outdent();
      writer.writeLn("call: " + this.call);
      writer.writeLn("apply: " + this.apply);

      writer.leave("}");
    },

    toString: function () {
      return "[class " + this.classInfo.instanceInfo.name.name + "]";
    }
  };

  var callable = Domain.coerceCallable(Class);
  defineNonEnumerableProperty(Class, "call", callable.call);
  defineNonEnumerableProperty(Class, "apply", callable.apply);

  Class.instanceConstructor = Class;
  Class.toString = Class.prototype.toString;

  // Traits are below the dynamic instant prototypes,
  // i.e. this.dynamicPrototype === Object.getPrototypeOf(this.instanceConstructor.prototype)
  // and we cache the dynamic instant prototype as this.dynamicPrototype.
  //
  // Traits are not visible to the AVM script.
  Class.native = {
    instance: {
      prototype: {
        get: function () { return this.dynamicPrototype; }
      }
    }
  };
  return Class;
})();

function MethodClosure($this, fn) {
  var bound = safeBind(fn, $this);
  defineNonEnumerableProperty(this, "call", bound.call.bind(bound));
  defineNonEnumerableProperty(this, "apply", bound.apply.bind(bound));
}

MethodClosure.prototype = {
  toString: function () {
    return "function Function() {}";
  }
};