---
layout: post
title: "My experiments with WASM and OpenGL"
date: 2025-03-01
tags: wasm webgl opengl
---

# Introduction

The last few weeks, OpenGL has caught my eye (frankly, it was a hiring challenge that nerd sniped me). I had 0
experience with OpenGL whatsover and thought that this might be a good time to give graphics a shot! If nothing I'll at
least revise the
graphics concepts that I've long forgotten after my 6th Semester.

However, I should mention that this post is not intended to be a learning guide for OpenGL or WASM, I have attached
resources in the end for the same.
This is supposed to be my journal of sorts regarding all the mistakes I did over the last 10 days.

## Challenge specifications

- Render 1 Million Spheres.
- Maintain dynamic lighting in the scene.
- Highlighting for each sphere.
- Maintaining 60 FPS.

## My approach

The specs at which my poor M1 managed to render the spheres was this -

1. Rendered 10k spheres with instances method.
2. Single light source to emulate phong lighting with proper attenuation techniques.
3. 4 unique texture support (you can add as many as you want).

The stress test on this project showed that close to 100k spheres could be rendered locally before it starts cracking. (
Oh, to be GPU poor :(( )
You can check out the source code implementation here (note, it's still poorly documented but the building instructions
are there) -

{% include link-preview.html
title="Multiple Spheres"
description="Multiple Sphere rendering"
url="https://github.com/uds5501/multiple-spheres"
domain="github.com"
%}

It yielded the following mini demo
[![CPP implementation]({{site.baseurl}}/assets/images/posts/2025-03-01-opengl-webgl-porting/demo-img.png)](https://www.youtube.com/shorts/R5YZGdQ08io)

## WASM and OpenGL

A funny thing happened while I was trying to demo this. The poor laptop decided to malfunction and load half backed
scene with one quarter of the scene gone!
It was at that moment realization hits, maybe it's time to port this to the web and not my machine be a blocker for the
demo.

**The solution?**

Port the entire project to WASM and WebGL. The project was already in C++ and OpenGL, so it was just a matter of finding
the right libraries and tools to port it to the web.
Thankfully, LLM is your friend in conversions while [emscripten](https://emscripten.org/docs/) is the tool for this job.

The Iframe below is the demo of the project build specifically for web.

## 🎮 Camera Controls

To play around with the demo, use these keys -

| Action                             | Key                             |
|------------------------------------|---------------------------------|
| **Move Forward**                   | `W`                             |
| **Move Backward**                  | `S`                             |
| **Move Left**                      | `A`                             |
| **Move Right**                     | `D`                             |
| **Move Up**                        | `Space`                         |
| **Move Down**                      | `Z`                             |
| **Sprint (Faster Movement)**       | `Left Shift (Hold)`             |
| **Stop Sprinting**                 | `Left Shift (Release)`          |
| **Look Around**                    | `Mouse Left Click + Move Mouse` |
| **Unlock Cursor**                  | `Mouse Left Click (Release)`    |
| **Cycle the texture for a sphere** | `Click on sphere`               |

<iframe src="/mindpalace/assets/wasm-demo/index.html" class="responsive-iframe"></iframe>

## Mistakes through the process 🤦🏾

I believe anyone can learn this tech with the presence of resource and LLMs, however, It's worth to mention the mistakes
that your
cursor IDE might not be able to figure out after a while of composition to and fro.

### Mistake 1: Weird flattened sphere instead of a round sphere.

VBO and VAO are the bread and butter of OpenGL however they may not always be well documented in the LLMs or the
tutorials.
I was incrementally adding colours, transformations and then textures to
my [instanced spheres](https://learnopengl.com/Advanced-OpenGL/Instancing).
For some reason, the textures were being flattened out like shown in the image.

![flattened-textures.png]({{site.baseurl}}/assets/images/posts/2025-03-01-opengl-webgl-porting/flattened-textures.png)

Before I talk about the culprit, let me explain what goes into rendering an object. There's a **VAO (Vertex Array
Object)** that
stores the mapping of the **VBO (Vertex Buffer Object)** to the shader attributes. The VBO stores the vertices, indices
and the texture coordinates. The shader then uses these attributes to render the object.

Your shader (written in `glsl`) will expect inputs supplied by the VAO. My vertex shader (the one that's responsible for
transforming the vertices) looked like this -

```glsl
#version 330 core
layout (location = 0) in vec3 aPos;
layout (location = 1) in vec3 aNormal;
layout (location = 2) in vec2 aTexCoords;
layout (location = 3) in mat4 instanceMatrix;
layout (location = 7) in vec4 instanceColor;
layout (location = 8) in int textureIndex;

out vec3 Normal;
out vec3 currentPosition;
out vec4 color;
out vec2 textCoords;
flat out int TexIndex; 

uniform mat4 camMatrix;
uniform mat4 model;

void main()
{
    currentPosition = vec3(instanceMatrix * vec4(aPos, 1.0f));
    gl_Position = camMatrix * vec4(currentPosition, 1.0);
    Normal = normalize(aNormal);
    color = instanceColor;
    TexIndex = textureIndex;
    textCoords = aTexCoords;
}
```

It took the following elements as input -

1. At position 0, the vertex positions.
2. At position 1, the normals.
3. At position 2, the texture coordinates.
4. At position 3, the transformation matrix for the instance of the sphere.
5. At position 7, the color of the instance. (why 7? the transformation matrix is **4x4** in size).
6. At position 8, the texture index, i.e., which texture needs to be rendered here.

Sounds good, now how do i map it? Take a look at the code below.

```cpp
// src/InstancedSphere.cpp
    shapeVAO.LinkAttrib(shapeVBO, 0, 3, GL_FLOAT, 8 * sizeof(float), (void *)0);                   // saved the basic mesh points.
    shapeVAO.LinkAttrib(shapeVBO, 1, 3, GL_FLOAT, 8 * sizeof(float), (void *)(3 * sizeof(float))); // save the indices from the same shape buffer
    shapeVAO.LinkAttrib(shapeVBO, 2, 2, GL_FLOAT, 8 * sizeof(float), (void *)(6 * sizeof(float))); // save texture coords

    instanceVBO = VBO(mat4s);
    for (int i = 0; i < 4; i++)
    {
        shapeVAO.LinkAttrib(instanceVBO, 2 + i, 4, GL_FLOAT, sizeof(glm::mat4), (void *)(i * sizeof(glm::vec4)));
        glVertexAttribDivisor(2 + i, 1); // This tells OpenGL this is per-instance
    }
    colorVBO = VBO(instanceColors);                                              // this should be dynamic
    shapeVAO.LinkAttrib(colorVBO, 6, 4, GL_FLOAT, 4 * sizeof(float), (void *)0); // link the indices from the color buffer.
    glVertexAttribDivisor(6, 1);

    textureVBO = VBO(instanceTextures);
    textureVBO.Bind();
    shapeVAO.LinkAttrib(textureVBO, 7, 1, GL_INT, sizeof(int), (void *)0); // link texture ids
```

Here I am linking the following:

1. At position 0, map shape buffer's first 3 elements to the shader to act as vertex locations.
2. At position 1, map shape buffer's next 3 elements to the shader to act as normals.
3. At position 2, map shape buffer's next 2 elements to the shader to act as texture coordinates.
4. At position 2 + i, map the instance buffer's `i`th element to the shader to act as one row of the transformation
   matrix, $(i \in [0,3])$.
5. At position 6, map the color buffer's 4 elements to the shader to act as the color of the instance.
6. At position 7, map the texture buffer's 1 element to the shader to act as the texture index.

**Spotted the error?**

I overrode the texture coordinate with the row of transformation matrix :) the correct mapping should've been -

```cpp
    for (int i = 0; i < 4; i++)
    {
        shapeVAO.LinkAttrib(instanceVBO, 3 + i, 4, GL_FLOAT, sizeof(glm::mat4), (void *)(i * sizeof(glm::vec4)));
        glVertexAttribDivisor(3 + i, 1); // This tells OpenGL this is per-instance
    }
    colorVBO = VBO(instanceColors);                                              // this should be dynamic
    shapeVAO.LinkAttrib(colorVBO, 7, 4, GL_FLOAT, 4 * sizeof(float), (void *)0); // link the indices from the color buffer.
    glVertexAttribDivisor(7, 1);

    textureVBO = VBO(instanceTextures);
    textureVBO.Bind();
    shapeVAO.LinkAttrib(textureVBO, 8, 1, GL_INT, sizeof(int), (void *)0); // link texture ids
```

### Mistake 2: VAO's being reused between spheres and light source.

There's a reason why I am using pointers to individual meshes for spheres and light object. Earlier when I was using
individual objects to
draw multiple spheres (see `src/Spheres.cpp`), I was noticing that the spheres are suddenly being rendered as cubes with
some hemispherical lightings on top of it, like this:

![weird-cube.png]({{site.baseurl}}/assets/images/posts/2025-03-01-opengl-webgl-porting/weird-cube.png)

Why was this happening? Let's take a look at how it was being initialized:

```cpp
        std::vector<Sphere> spheres = {
		new Sphere(0.3f, 20, 20, glm::vec3(-1.0f, 0.0f, -2.0f)),
		new Sphere(0.3f, 20, 20, glm::vec3(1.0f, 0.0f, -2.0f)),
		new Sphere(0.3f, 20, 20, glm::vec3(0.0f, 1.0f, -3.0f)),
		new Sphere(0.3f, 20, 20, glm::vec3(0.0f, -1.0f, -3.0f)),
		new Sphere(0.3f, 20, 20, glm::vec3(-1.5f, 1.5f, -4.0f)),
		new Sphere(0.3f, 20, 20, glm::vec3(1.5f, 1.5f, -4.0f)),
		new Sphere(0.3f, 20, 20, glm::vec3(-1.5f, -1.5f, -4.0f)),
		new Sphere(0.3f, 20, 20, glm::vec3(1.5f, -1.5f, -4.0f))};
		
		// some code
		
		VAO lightVAO;
		lightVAO.Bind();
```

- You initialize the spheres with their own VAO and VBOs internally. IDs from 1-8 are registered in each sphere.
- The moment these sphere objects are created and pushed in vector, they were deconstructed and the IDs earlier being
  bound for Spheres (1-8) were set free.
- Now, you bind the lightVAO and the ID 1 is being used for the light object, hence messing the vertex rendering of all
  the spheres!

Solution? You'll laugh at this.

```cpp
   std::vector<Sphere*> spheres
```

## Conclusion

I had fun. Honestly it was fun to do something aimless and just for the sake of learning. I'll be reading up the
compilers next (currently a big black box for me in terms of implementation, kinda excited for this!)

See you in the next one? :D

## Resources

1. [OpenGL Resources](https://learnopengl.com/)
2. [WebGL Resource](https://webglfundamentals.org/)
3. [Tutorial series](https://www.youtube.com/watch?v=XpBGwZNyUh0&list=PLPaoO-vpZnumdcb4tZc4x5Q-v7CkrQ6M-)
