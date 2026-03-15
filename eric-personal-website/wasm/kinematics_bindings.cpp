#include <emscripten/bind.h>

#include <algorithm>
#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>

#include "generic_ik/kinematics.h"

using namespace emscripten;
using Tree = kinematics::KinematicTree<double>;

Tree load_urdf_from_string(const std::string & urdf_content)
{
  const std::string tmp_path = "/tmp_urdf.xml";
  { std::ofstream f(tmp_path); f << urdf_content; }
  return kinematics::load_from_urdf<double>(tmp_path);
}

// FK returning a flat 16-element column-major array (matches Three.js Matrix4.fromArray)
std::vector<double> fk_flat(Tree & tree, const std::string & link_name)
{
  auto xform = tree.forward_kinematics(link_name);
  std::vector<double> out(16);
  Eigen::Map<Eigen::Matrix4d>(out.data()) = xform.matrix();
  return out;
}

std::vector<double> get_joint_limits(const Tree & tree, const std::string & joint_name)
{
  auto limits = tree.get_limits_by_name(joint_name);
  return {limits.first, limits.second};
}

std::vector<std::string> get_link_names(const Tree & tree)
{
  std::vector<std::string> names;
  for (const auto & node : tree.nodes) {
    if (std::holds_alternative<kinematics::Link>(node)) {
      names.push_back(kinematics::get_name<double>(node));
    }
  }
  return names;
}

struct JointInfo
{
  std::string name;
  std::string parent_link;
  std::string child_link;
  std::string type;
  double lower_limit;
  double upper_limit;
};

std::vector<JointInfo> get_joint_info(const Tree & tree)
{
  std::vector<JointInfo> info;
  for (size_t i = 0; i < tree.nodes.size(); i++) {
    const auto & node = tree.nodes[i];
    std::string type;
    std::visit(
      [&type](const auto & obj) {
        using T = std::decay_t<decltype(obj)>;
        if constexpr (std::is_same_v<T, kinematics::RevoluteJoint<double>>)
          type = "revolute";
        else if constexpr (std::is_same_v<T, kinematics::ContinuousJoint<double>>)
          type = "continuous";
        else if constexpr (std::is_same_v<T, kinematics::PrismaticJoint<double>>)
          type = "prismatic";
        else if constexpr (std::is_same_v<T, kinematics::FixedJoint<double>>)
          type = "fixed";
      },
      node);

    if (type.empty()) continue;

    std::string name = kinematics::get_name<double>(node);

    std::string parent_link;
    auto parent_idx = tree.get_parent_index(i);
    if (parent_idx) {
      parent_link = kinematics::get_name<double>(tree.nodes[parent_idx.value()]);
    }

    std::string child_link;
    auto children = tree.get_children_indices(i);
    if (!children.empty()) {
      child_link = kinematics::get_name<double>(tree.nodes[children[0]]);
    }

    double lower = 0, upper = 0;
    if (type != "fixed") {
      auto limits = tree.get_limits_by_name(name);
      lower = limits.first;
      upper = limits.second;
    }

    info.push_back({name, parent_link, child_link, type, lower, upper});
  }
  return info;
}

EMSCRIPTEN_BINDINGS(kinematics_module)
{
  register_vector<std::string>("StringVector");
  register_vector<double>("DoubleVector");

  value_object<JointInfo>("JointInfo")
    .field("name", &JointInfo::name)
    .field("parentLink", &JointInfo::parent_link)
    .field("childLink", &JointInfo::child_link)
    .field("type", &JointInfo::type)
    .field("lowerLimit", &JointInfo::lower_limit)
    .field("upperLimit", &JointInfo::upper_limit);

  register_vector<JointInfo>("JointInfoVector");

  class_<Tree>("KinematicTree")
    .constructor<>()
    .function("getActiveJointNames", &Tree::get_active_joint_names)
    .function("updateTheta",
      select_overload<void(const std::string &, double)>(&Tree::update_theta_by_name))
    .function("getTheta", &Tree::get_theta_by_name);

  function("loadUrdfFromString", &load_urdf_from_string);
  function("fkFlat", &fk_flat);
  function("getJointLimits", &get_joint_limits);
  function("getLinkNames", &get_link_names);
  function("getJointInfo", &get_joint_info);
}
